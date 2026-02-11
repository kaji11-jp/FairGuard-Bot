const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');
const { isAdminUser } = require('../utils/permissions');
const { blacklistCache, graylistCache } = require('../utils/bannedWords');
const { fetchContext, callGemini } = require('../services/ai');
const { addWarning, getActiveWarningCount } = require('../services/warnings');
const { saveModLog } = require('../utils/logs');
const { createWarningEmbed, createWarningDeleteEmbed } = require('../utils/embedHelpers');
const logger = require('../utils/logger');
const db = require('../database');

// 長文・連投検出（AI判定付き）
async function checkSpamAndLongMessage(message, client) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    if (isAdminUser(message.member)) return;

    const now = Date.now();
    const userId = message.author.id;
    const channelId = message.channel.id;
    const messageLength = message.content.length;

    try {
        db.prepare('INSERT INTO message_tracking (user_id, channel_id, timestamp, message_length) VALUES (?, ?, ?, ?)')
            .run(userId, channelId, now, messageLength);
    } catch (error) {
        logger.error('メッセージ追跡記録エラー', {
            userId,
            channelId,
            error: error.message,
            stack: error.stack
        });
    }

    const timeWindow = now - CONFIG.SPAM_TIME_WINDOW;
    const recentMessages = db.prepare(`
        SELECT COUNT(*) as count FROM message_tracking 
        WHERE user_id = ? AND channel_id = ? AND timestamp > ?
    `).get(userId, channelId, timeWindow);

    const isLongMessage = messageLength > CONFIG.MAX_MESSAGE_LENGTH;
    const isSpamCandidate = recentMessages.count >= CONFIG.SPAM_MESSAGE_COUNT;

    if (isLongMessage || isSpamCandidate) {
        const prompt = `
あなたは公平なモデレーターAIです。以下の発言が「長文投稿」または「連投（スパム）」として処罰すべきか判定してください。

【判定基準】
1. **長文投稿**: 2000文字を超えるメッセージは原則として【PUNISH】ですが、以下の場合は【SAFE】です：
   - コードブロックや引用を含む技術的な説明
   - 重要な情報をまとめた正当な長文
   - 物語や創作活動の一環としての長文
2. **連投（スパム）**: 短時間に複数のメッセージを投稿している場合は原則として【PUNISH】ですが、以下の場合は【SAFE】です：
   - 会話の流れとして自然な連続投稿
   - 質問への回答として複数メッセージに分けている
   - 重要な情報を伝えるための連続投稿
3. **文脈の考慮**: 文脈を考慮し、正当な理由がある場合は【SAFE】としてください。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"verdict": "PUNISH" or "SAFE", "reason": "日本語で短い理由を記述", "type": "LONG_MESSAGE" or "SPAM" or "BOTH"}

[対象発言]: ${message.content}
[文字数]: ${messageLength}文字
[過去10秒以内のメッセージ数]: ${recentMessages.count}件
        `;

        let result;
        try {
            result = await callGemini(prompt);
        } catch (error) {
            logger.error('AI判定エラー（長文・連投検出）', {
                userId: message.author.id,
                error: error.message,
                stack: error.stack
            });
            // エラー時は安全側に倒して処理を続行しない
            return;
        }

        if (!result) {
            logger.warn('AI判定失敗: nullレスポンス（長文・連投検出）', {
                userId: message.author.id
            });
            return;
        }

        if (result.verdict === "PUNISH") {
            const currentWarnCount = getActiveWarningCount(userId);

            const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);

            if (currentWarnCount < CONFIG.WARN_THRESHOLD) {
                const logId = Date.now().toString(36);

                saveModLog({
                    id: logId,
                    type: result.type === 'LONG_MESSAGE' ? 'LONG_MESSAGE' : result.type === 'SPAM' ? 'SPAM' : 'SPAM_LONG',
                    userId: userId,
                    moderatorId: client.user.id,
                    timestamp: Date.now(),
                    reason: result.reason,
                    content: message.content,
                    contextData: context,
                    aiAnalysis: JSON.stringify(result)
                });

                const newWarnCount = addWarning(userId, result.reason, client.user.id, logId);

                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle(`⚠️ ${result.type === 'LONG_MESSAGE' ? '長文投稿' : result.type === 'SPAM' ? '連投' : '長文・連投'}による警告`)
                    .setDescription(`${message.author} が${result.type === 'LONG_MESSAGE' ? '長文を投稿' : result.type === 'SPAM' ? '連投を行' : '長文投稿・連投を行'}いました。`)
                    .addFields(
                        { name: '理由', value: result.reason, inline: false },
                        { name: '警告回数', value: `${newWarnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                        { name: '文字数', value: `${messageLength}文字`, inline: true },
                        { name: 'メッセージ数', value: `${recentMessages.count}件/${CONFIG.SPAM_TIME_WINDOW / 1000}秒`, inline: true },
                        { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
                    )
                    .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

                message.channel.send({ embeds: [embed] }).catch(error => {
                    logger.error('警告メッセージ送信エラー', {
                        userId: message.author.id,
                        error: error.message
                    });
                });
            } else {
                try {
                    await message.delete();
                } catch (deleteError) {
                    if (deleteError.code === 10008) {
                        logger.debug('メッセージは既に削除されています（削除フロー内）');
                    } else {
                        logger.warn('メッセージ削除エラー（削除フロー内）', {
                            messageId: message.id,
                            error: deleteError.message
                        });
                        return; // 削除に失敗した場合は警告も出さない（権限不足やエラー時）
                    }
                }

                try {
                    const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
                    const logId = Date.now().toString(36);

                    saveModLog({
                        id: logId,
                        type: result.type === 'LONG_MESSAGE' ? 'LONG_MESSAGE' : result.type === 'SPAM' ? 'SPAM' : 'SPAM_LONG',
                        userId: userId,
                        moderatorId: client.user.id,
                        timestamp: Date.now(),
                        reason: result.reason,
                        content: message.content,
                        contextData: context,
                        aiAnalysis: JSON.stringify(result)
                    });

                    const newWarnCount = addWarning(userId, result.reason, client.user.id, logId);

                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle(`🚫 ${result.type === 'LONG_MESSAGE' ? '長文投稿' : result.type === 'SPAM' ? '連投' : '長文・連投'}による削除`)
                        .setDescription(`${message.author} の発言は削除されました。`)
                        .addFields(
                            { name: '理由', value: result.reason, inline: false },
                            { name: '警告回数', value: `${newWarnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                            { name: '文字数', value: `${messageLength}文字`, inline: true },
                            { name: 'メッセージ数', value: `${recentMessages.count}件/${CONFIG.SPAM_TIME_WINDOW / 1000}秒`, inline: true },
                            { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
                        )
                        .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

                    message.channel.send({ embeds: [embed] }).catch(error => {
                        logger.error('削除通知メッセージ送信エラー', {
                            userId: message.author.id,
                            error: error.message
                        });
                    });
                } catch (error) {
                    logger.error('長文・連投処罰処理エラー', {
                        userId: message.author.id,
                        error: error.message,
                        stack: error.stack
                    });
                }
            }
        } else {
            logger.debug('AI判定: SAFE（長文・連投検出）', {
                userId: message.author.id,
                tag: message.author.tag,
                isLongMessage,
                isSpamCandidate,
                reason: result?.reason
            });
        }
    }

    const oneHourAgo = now - CONFIG.ONE_HOUR_MS;
    try {
        db.prepare('DELETE FROM message_tracking WHERE timestamp < ?').run(oneHourAgo);
    } catch (error) {
        logger.error('メッセージ追跡削除エラー', {
            oneHourAgo,
            error: error.message,
            stack: error.stack
        });
    }
}

// モデレーションロジック (AIハイブリッド)
async function handleModeration(message, client) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;

    if (isAdminUser(message.member)) {
        logger.debug('管理者メッセージのためスキップ', { userId: message.author.id });
        return;
    }

    const content = message.content.toLowerCase();
    logger.debug('モデレーションチェック開始', { userId: message.author.id, content: content.substring(0, 50) });

    // A. ブラックリスト (即死)
    for (const word of blacklistCache) {
        if (content.includes(word)) {
            logger.info('ブラックリストワード検知', { userId: message.author.id, word });
            const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            await executePunishment(message, "BLACKLIST", word, "即時削除 (禁止ワード)", context, null, client);
            return;
        }
    }

    // B. グレーリスト (AI審議)
    let grayMatch = null;
    for (const word of graylistCache) {
        if (content.includes(word)) {
            grayMatch = word;
            break;
        }
    }

    if (grayMatch) {
        logger.info('グレーリストワード検知', { userId: message.author.id, word: grayMatch });
        const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);

        const { getRulesText } = require('../services/rules');
        const serverRules = getRulesText();
        const ruleSection = serverRules ? `\n【サーバー憲法 (追加ルール)】\n以下のルールに違反している場合も【UNSAFE】としてください：\n${serverRules}\n` : '';

        const prompt = `
あなたは公平なモデレーターAIです。以下の[対象発言]が、文脈において「処罰すべき攻撃的発言」または「サーバー憲法違反」か判定してください。

【重要：判定ルール】
1. **メタ発言の保護**: 禁止ワードそのものについて語っている場合（例：「『死ね』は良くない」）は【SAFE】です。
2. **私情の排除**: 過去の文脈でユーザーが態度が悪かったとしても、今回の発言自体が無害なら【SAFE】としてください。
3. **UNSAFEの条件**: 明確に他者を傷つける意図で使用している場合、または【サーバー憲法】に違反している場合。
${ruleSection}
【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"verdict": "SAFE" or "UNSAFE", "reason": "日本語で短い理由を記述（違反したルールがあれば言及してください）"}

[文脈]: ${context}
[対象発言]: ${message.content}
        `;

        let result;
        try {
            result = await callGemini(prompt);
        } catch (error) {
            logger.error('AI判定エラー（グレーリスト）', {
                userId: message.author.id,
                grayMatch,
                error: error.message,
                stack: error.stack
            });
            // エラー時は安全側に倒して処理を続行しない
            return;
        }

        if (!result) {
            logger.warn('AI判定失敗: nullレスポンス（グレーリスト）', {
                userId: message.author.id,
                grayMatch
            });
            return;
        }

        if (result.verdict === "UNSAFE") {
            logger.info('AI判定: UNSAFE（グレーリスト）', { userId: message.author.id, reason: result.reason });
            // フルモードの場合、確認フローを使用
            if (CONFIG.AI_CONFIRMATION_ENABLED) {
                const { requestAIConfirmation } = require('../services/aiConfirmation');
                const confirmation = await requestAIConfirmation(message, result, context, grayMatch);
                if (confirmation) {
                    const alertCh = message.guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
                    if (alertCh) {
                        alertCh.send({ embeds: [confirmation.embed], components: [confirmation.row] }).catch(error => {
                            logger.error('管理者確認メッセージ送信エラー', {
                                channelId: CONFIG.ALERT_CHANNEL_ID,
                                error: error.message
                            });
                        });
                    }
                    return; // 確認待ち
                }
            }
            // 確認フローが無効または失敗した場合は通常処理
            await executePunishment(message, "AI_JUDGE", grayMatch, result.reason, context, result, client);
        } else {
            logger.info('AI判定: SAFE（グレーリスト）', {
                userId: message.author.id,
                tag: message.author.tag,
                grayMatch,
                reason: result?.reason
            });
        }
    }

    // トーン分析（ソフト警告）- フルモードのみ
    if (CONFIG.SOFT_WARNING_ENABLED) {
        const { analyzeTone } = require('../services/toneAnalysis');
        await analyzeTone(message).catch(error => {
            logger.error('トーン分析エラー', {
                userId: message.author.id,
                error: error.message
            });
        });
    }

    // 信用スコア更新
    try {
        const { updateTrustScore, isLowTrustUser } = require('../services/trustScore');
        updateTrustScore(message.author.id);

        // 低信用スコアユーザーの場合は厳格化
        if (isLowTrustUser(message.author.id)) {
            // 追加のチェックやアラートをここに追加可能
        }
    } catch (error) {
        logger.error('信用スコア更新エラー', {
            userId: message.author.id,
            error: error.message
        });
    }
}

async function executePunishment(message, type, word, reason, context, aiResult, client) {
    const { addWarning, getActiveWarningCount } = require('../services/warnings');
    const { saveModLog } = require('../utils/logs');
    const { EmbedBuilder } = require('discord.js');

    try {
        const logId = Date.now().toString(36);

        const currentWarnCount = getActiveWarningCount(message.author.id);

        saveModLog({
            id: logId, type: type, userId: message.author.id, moderatorId: client.user.id,
            timestamp: Date.now(), reason: reason, content: message.content,
            contextData: context, aiAnalysis: aiResult ? JSON.stringify(aiResult) : null
        });

        const warnCount = addWarning(message.author.id, reason, client.user.id, logId);

        if (currentWarnCount < CONFIG.WARN_THRESHOLD) {
            const embed = createWarningEmbed({
                user: message.author,
                reason: reason,
                warnCount: warnCount,
                logId: logId,
                type: type,
                word: word,
                aiResult: aiResult
            });

            message.channel.send({ embeds: [embed] }).catch(error => {
                logger.error('警告メッセージ送信エラー（executePunishment）', {
                    userId: message.author.id,
                    error: error.message
                });
            });
        } else {
            try {
                await message.delete();
            } catch (deleteError) {
                if (deleteError.code === 10008) {
                    logger.debug('メッセージは既に削除されています（executePunishment）');
                } else {
                    logger.warn('メッセージ削除エラー（executePunishment）', {
                        messageId: message.id,
                        error: deleteError.message
                    });
                    return; // 削除に失敗した場合は警告も出さない
                }
            }

            const embed = createWarningDeleteEmbed({
                user: message.author,
                reason: reason,
                warnCount: warnCount,
                logId: logId,
                type: type,
                word: word,
                aiResult: aiResult
            });

            message.channel.send({ embeds: [embed] }).catch(error => {
                logger.error('削除通知メッセージ送信エラー（executePunishment）', {
                    userId: message.author.id,
                    error: error.message
                });
            });
        }

        if (warnCount >= CONFIG.WARN_THRESHOLD) {
            const alertCh = message.guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
            if (alertCh) {
                alertCh.send(`🚨 **要レビュー**: ${message.author} が警告閾値に達しました。`).catch(error => {
                    logger.error('アラートチャンネル送信エラー', {
                        error: error.message
                    });
                });
            }
        }
    } catch (error) {
        logger.error('処罰実行エラー', {
            userId: message.author.id,
            type,
            error: error.message,
            stack: error.stack
        });
    }
}

module.exports = {
    checkSpamAndLongMessage,
    handleModeration
};
