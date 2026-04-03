const { EmbedBuilder, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config');
const { isAdminUser } = require('../utils/permissions');
const { checkRateLimit } = require('../utils/rateLimit');
const { saveCommandLog, saveModLog } = require('../utils/logs');
const { getOpenTicket, setOpenTicket, removeOpenTicket } = require('../utils/tickets');
const { addWarning, reduceWarning, getActiveWarningCount } = require('../services/warnings');
const { fetchContext, callGemini, checkWarnAbuse } = require('../services/ai');
const { blacklistCache, graylistCache, loadBannedWords } = require('../utils/bannedWords');
const { pendingWarnsCache } = require('../utils/cache');
const { checkHealth, checkHealthDetailed } = require('../utils/healthCheck');
const { validateLogId, validateReason, validateWord, validateUserId, validateNumber } = require('../utils/validation');
const logger = require('../utils/logger');
const db = require('../database');

// 手動警告の実行（messageまたはinteractionに対応）
async function executeManualWarn(source, target, reason, content, context, messageId, moderatorId = null) {
    // messageまたはinteractionのどちらかを判定
    // interactionにはisChatInputCommand()メソッドがある
    const isInteraction = source.isChatInputCommand && typeof source.isChatInputCommand === 'function';
    const guild = source.guild;
    const channel = source.channel;
    const author = isInteraction ? source.user : source.author;
    const member = source.member;

    const actualModeratorId = moderatorId || author.id;
    const actualModerator = moderatorId ? await guild.members.fetch(moderatorId).catch(() => null) : member;

    const logId = Date.now().toString(36);

    saveModLog({
        id: logId,
        type: 'WARN_MANUAL',
        userId: target.id,
        moderatorId: actualModeratorId,
        timestamp: Date.now(),
        reason: reason,
        content: content,
        contextData: context,
        aiAnalysis: null
    });

    const count = addWarning(target.id, reason, actualModeratorId, logId);

    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('⚠️ 手動警告')
        .setDescription(`${target} に警告が発行されました`)
        .addFields(
            { name: '警告回数', value: `${count}/${CONFIG.WARN_THRESHOLD}`, inline: true },
            { name: '理由', value: reason, inline: true },
            { name: '警告ID', value: `\`${logId}\``, inline: false }
        );

    if (messageId) {
        embed.addFields({ name: '対象メッセージ', value: `[メッセージへジャンプ](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})`, inline: false });
    }

    // 警告メッセージを送信
    await channel.send({ embeds: [embed] }).catch(error => {
        logger.error('手動警告メッセージ送信エラー', {
            channelId: channel.id,
            error: error.message
        });
    });

    if (CONFIG.ALERT_CHANNEL_ID && CONFIG.ALERT_CHANNEL_ID.length > 0) {
        const alertCh = guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
        if (alertCh) {
            const logEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('📝 手動警告ログ')
                .addFields(
                    { name: '警告者', value: `${actualModerator?.user || actualModeratorId} (${actualModeratorId})`, inline: true },
                    { name: '対象', value: `${target} (${target.id})`, inline: true },
                    { name: '理由', value: reason, inline: false },
                    { name: '警告ID', value: `\`${logId}\``, inline: false }
                )
                .setTimestamp();
            await alertCh.send({ embeds: [logEmbed] }).catch(error => {
                logger.error('アラートチャンネル送信エラー（手動警告）', {
                    error: error.message
                });
            });
        }
    }
}

async function handleCommand(message) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) {
        saveCommandLog(message.author.id, 'UNKNOWN', [], null, message.channel.id, false);
        return;
    }

    if (!isAdminUser(message.member)) {
        if (!checkRateLimit(message.author.id)) {
            saveCommandLog(message.author.id, 'RATE_LIMIT', [], message.guild.id, message.channel.id, false);
            return message.reply('⏱️ コマンドの実行頻度が高すぎます。しばらく待ってから再試行してください。');
        }
    }

    const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = isAdminUser(message.member);

    try {
        saveCommandLog(message.author.id, command, args, message.guild.id, message.channel.id, true);
    } catch (error) {
        logger.error('コマンドログ保存エラー', {
            userId: message.author.id,
            command,
            error: error.message
        });
    }

    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📜 コマンド一覧')
            .addFields({ name: '👤 ユーザー用', value: `\`${CONFIG.PREFIX}appeal <ID> <理由>\`: 異議申し立て\n\`${CONFIG.PREFIX}ticket open\`: 問い合わせ作成` });

        if (isAdmin) {
            embed.addFields({
                name: '👮 管理者用',
                value: `\`${CONFIG.PREFIX}warn <@user> [理由]\`: 手動警告\n\`${CONFIG.PREFIX}unwarn <ユーザーID> [数]\`: 警告減\n\`${CONFIG.PREFIX}addword <単語> [black/gray]\`: ワード追加\n\`${CONFIG.PREFIX}removeword <単語>\`: ワード削除\n\`${CONFIG.PREFIX}listword\`: 一覧表示\n\`${CONFIG.PREFIX}timeout_user <ユーザーID>\`: タイムアウト\n\`${CONFIG.PREFIX}cmdlog [件数]\`: コマンド履歴\n\`${CONFIG.PREFIX}warnlog [ユーザーID] [件数]\`: 警告履歴\n\`${CONFIG.PREFIX}ticket close\`: チケット終了`
            });
            embed.setColor('#ff9900');
        }
        return message.reply({ embeds: [embed] });
    }

    if (command === 'appeal') {
        const [logId, ...reasonParts] = args;
        const reason = reasonParts.join(' ');

        // バリデーション
        if (!logId || !reason) return message.reply('❌ 理由を入力してください: `!appeal <ID> <理由>`');

        const logIdValidation = validateLogId(logId);
        if (!logIdValidation.valid) {
            return message.reply(`❌ ${logIdValidation.error}`);
        }

        const reasonValidation = validateReason(reason);
        if (!reasonValidation.valid) {
            return message.reply(`❌ ${reasonValidation.error}`);
        }

        const validatedReason = reasonValidation.value;

        const log = db.prepare('SELECT * FROM mod_logs WHERE id = ?').get(logId);
        if (!log || log.user_id !== message.author.id) return message.reply('❌ データなし');
        if (log.is_resolved) return message.reply('✅ 既に解決済みです');

        const APPEAL_DEADLINE_MS = CONFIG.APPEAL_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
        const timeSincePunishment = Date.now() - log.timestamp;
        if (timeSincePunishment > APPEAL_DEADLINE_MS) {
            const daysPassed = Math.floor(timeSincePunishment / (24 * 60 * 60 * 1000));
            return message.reply(`❌ 異議申し立ての期限（${CONFIG.APPEAL_DEADLINE_DAYS}日以内）を過ぎています。処罰から${daysPassed}日経過しています。`);
        }

        message.channel.sendTyping();

        const prompt = `
あなたは公平な裁判官AIです。ユーザーの異議を審査してください。

【ルール】
1. **「言及」の保護**: 禁止ワードについて議論・引用している場合は、言葉自体が悪くても【ACCEPTED】です。
2. **過去は不問**: 過去の態度が悪くても、今回の発言と異議理由が正当なら【ACCEPTED】です。
3. **嘘の排除**: 文脈と明らかに矛盾する嘘の言い訳は【REJECTED】です。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"status": "ACCEPTED" or "REJECTED", "reason": "日本語で公平な理由を記述"}

<警告理由>
${log.reason}
</警告理由>
<ユーザー異議>
${validatedReason}
</ユーザー異議>
<元発言>
${log.content}
</元発言>
<文脈>
${log.context_data}
</文脈>
        `;

        let result;
        try {
            result = await callGemini(prompt);
        } catch (error) {
            logger.error('異議申し立てAI判定エラー', {
                userId: message.author.id,
                logId,
                error: error.message,
                stack: error.stack
            });
            return message.reply('❌ AI判定中にエラーが発生しました。しばらくしてから再試行してください。');
        }

        if (!result) {
            logger.warn('異議申し立てAI判定失敗: nullレスポンス', {
                userId: message.author.id,
                logId
            });
            return message.reply('❌ AI判定に失敗しました。しばらくしてから再試行してください。');
        }

        const isAccepted = result.status === 'ACCEPTED';
        if (isAccepted) {
            try {
                reduceWarning(message.author.id, 1);
                db.prepare('UPDATE mod_logs SET is_resolved = 1 WHERE id = ?').run(logId);
            } catch (error) {
                logger.error('異議申し立て処理エラー', {
                    userId: message.author.id,
                    logId,
                    error: error.message
                });
                return message.reply('❌ 処理中にエラーが発生しました。');
            }
        }

        const embed = new EmbedBuilder()
            .setColor(isAccepted ? '#00ff00' : '#ff0000')
            .setTitle(`⚖️ 審判結果: ${result.status}`)
            .setDescription(result.reason)
            .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

        message.reply({ embeds: [embed] });
        return;
    }

    if (command === 'ticket') {
        if (args[0] === 'open') {
            if (getOpenTicket(message.author.id)) return message.reply('❌ 既に開いています');

            if (!CONFIG.TICKET_CATEGORY_ID || CONFIG.TICKET_CATEGORY_ID.length === 0) {
                return message.reply('❌ チケットカテゴリーIDが設定されていません。管理者に連絡してください。');
            }

            const safeUsername = message.author.username
                .replace(/[^\w\u3040-\u30ff\u3400-\u9fff]/g, '-')
                .replace(/-{2,}/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 80) || 'user';
            const ch = await message.guild.channels.create({
                name: `ticket-${safeUsername}`,
                type: ChannelType.GuildText,
                parent: CONFIG.TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            setOpenTicket(message.author.id, ch.id);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
            ch.send({ content: `${message.author} お問い合わせをどうぞ`, components: [row] });
            message.reply(`✅ チケット作成: ${ch}`);
        }
        else if (args[0] === 'close' && isAdmin) {
            try {
                await message.channel.send('⌛ チケットを閉じています...');
                setTimeout(async () => {
                    try {
                        await message.channel.delete();
                    } catch (error) {
                        logger.error('チケットチャンネル削除エラー', {
                            channelId: message.channel.id,
                            error: error.message
                        });
                    }
                }, CONFIG.TICKET_CLOSE_DELAY || 2000);
            } catch (error) {
                logger.error('チケット終了処理エラー', {
                    channelId: message.channel.id,
                    error: error.message
                });
            }
        }
        return;
    }

    // --- Admin Commands ---
    if (!isAdmin) return;

    if (command === 'warn') {
        const target = message.mentions.users.first();
        const reasonInput = args.slice(1).join(' ') || '手動警告';
        if (!target) return message.reply('❌ ユーザー指定必須: `!warn <@user> [理由]`');

        // 理由のバリデーション
        const reasonValidation = validateReason(reasonInput);
        if (!reasonValidation.valid) {
            return message.reply(`❌ ${reasonValidation.error}`);
        }
        const reason = reasonValidation.value;

        let context = '';
        let content = '手動警告';
        let targetMessageId = null;

        if (message.reference) {
            try {
                const replyMsg = await message.channel.messages.fetch(message.reference.messageId);
                if (replyMsg.author.id !== target.id) {
                    return message.reply('❌ リプライ先のメッセージが対象ユーザーのものではありません');
                }
                content = replyMsg.content;
                targetMessageId = replyMsg.id;
                context = await fetchContext(message.channel, replyMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return message.reply('❌ メッセージの取得に失敗しました');
            }
        } else {
            try {
                const messages = await message.channel.messages.fetch({ limit: 50 });
                const targetMessages = messages.filter(m => m.author.id === target.id && !m.author.bot);

                if (targetMessages.size === 0) {
                    return message.reply('❌ 対象ユーザーのメッセージが見つかりませんでした');
                }

                const latestMsg = targetMessages.first();
                content = latestMsg.content;
                targetMessageId = latestMsg.id;
                context = await fetchContext(message.channel, latestMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return message.reply('❌ メッセージの取得に失敗しました');
            }
        }

        message.channel.sendTyping();

        const oneHourAgo = Date.now() - CONFIG.ONE_HOUR_MS;
        const recentWarns = db.prepare(`
            SELECT COUNT(*) as count, MAX(timestamp) as last_warn 
            FROM mod_logs 
            WHERE user_id = ? AND type = 'WARN_MANUAL' AND moderator_id = ? AND timestamp > ?
        `).get(target.id, message.author.id, oneHourAgo);

        let abuseCheck;
        try {
            abuseCheck = await checkWarnAbuse(message.author.id, target.id, reason, context, content);
        } catch (error) {
            logger.error('警告濫用チェックエラー', {
                moderatorId: message.author.id,
                targetId: target.id,
                error: error.message,
                stack: error.stack
            });
            // エラー時は警告を続行（安全側に倒す）
            abuseCheck = null;
        }

        if (abuseCheck && abuseCheck.is_abuse) {
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ 警告の濫用の可能性が検出されました')
                .setDescription(abuseCheck.reason)
                .addFields(
                    { name: '対象ユーザー', value: `${target}`, inline: true },
                    { name: '警告理由', value: reason, inline: true },
                    { name: '懸念点', value: abuseCheck.concerns?.join('\n') || 'なし', inline: false }
                );

            if (recentWarns.count >= 2) {
                const timeDiff = Date.now() - recentWarns.last_warn;
                const minutes = Math.floor(timeDiff / 60000);
                embed.addFields({
                    name: '⚠️ 警告頻度',
                    value: `過去1時間以内に同じユーザーへの警告が**${recentWarns.count}回**記録されています。\n最後の警告から${minutes}分経過しています。`,
                    inline: false
                });
            }

            embed.setFooter({ text: 'それでも警告を実行しますか？', iconURL: CONFIG.GEMINI_ICON });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`warn_confirm_${target.id}_${Date.now()}`)
                        .setLabel('✅ 実行する')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`warn_cancel_${Date.now()}`)
                        .setLabel('❌ キャンセル')
                        .setStyle(ButtonStyle.Danger)
                );

            const confirmMsg = await message.reply({ embeds: [embed], components: [row] });

            const pendingWarnData = {
                targetId: target.id,
                moderatorId: message.author.id,
                reason: reason,
                content: content,
                context: context,
                messageId: targetMessageId,
                confirmMsgId: confirmMsg.id
            };

            // TTL付きキャッシュに保存
            pendingWarnsCache.set(confirmMsg.id, pendingWarnData, CONFIG.PENDING_WARNS_CACHE_TTL);

            // 期限切れ時にボタンを無効化
            setTimeout(() => {
                if (pendingWarnsCache.has(confirmMsg.id)) {
                    pendingWarnsCache.delete(confirmMsg.id);
                    confirmMsg.edit({ components: [] }).catch(error => {
                        logger.warn('警告確認メッセージ編集エラー', {
                            messageId: confirmMsg.id,
                            error: error.message
                        });
                    });
                }
            }, CONFIG.PENDING_WARNS_CACHE_TTL);

            return;
        }

        try {
            await executeManualWarn(message, target, reason, content, context, targetMessageId);
        } catch (error) {
            logger.error('手動警告実行エラー', {
                moderatorId: message.author.id,
                targetId: target.id,
                error: error.message,
                stack: error.stack
            });
            return message.reply('❌ 警告の実行中にエラーが発生しました。');
        }
    }

    if (command === 'unwarn') {
        const userId = args[0];
        if (!userId) return message.reply('❌ ユーザーIDを指定してください: `!unwarn <ユーザーID> [減らす数]`');

        // ユーザーIDのバリデーション
        const userIdValidation = validateUserId(userId);
        if (!userIdValidation.valid) {
            return message.reply(`❌ ${userIdValidation.error}`);
        }

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply('❌ ユーザーが見つかりません');

        // 減らす数のバリデーション
        const amountValidation = validateNumber(args[1] || 1, 1, 100, '減らす数');
        if (!amountValidation.valid) {
            return message.reply(`❌ ${amountValidation.error}`);
        }
        const amount = amountValidation.value;

        const newCount = reduceWarning(userId, amount);

        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'UNWARN',
            userId: userId,
            moderatorId: message.author.id,
            timestamp: Date.now(),
            reason: `${amount}個の警告を削減`,
            content: '',
            contextData: '',
            aiAnalysis: null
        });

        message.reply(`✅ ${target.user} の警告を${amount}個削減しました (現在: ${newCount})`);
    }

    if (command === 'listword') {
        const blackList = Array.from(blacklistCache).join(', ') || 'なし';
        const grayList = Array.from(graylistCache).join(', ') || 'なし';
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle('📜 禁止ワード一覧')
            .addFields({ name: '🚫 即死 (Blacklist)', value: blackList }, { name: '⚡ AI審議 (Graylist)', value: grayList });
        message.reply({ embeds: [embed] });
    }

    if (command === 'addword') {
        const word = args[0];
        const typeArg = args[1]?.toLowerCase();
        if (!word) return message.reply('❌ `!addword <単語> [black/gray]`');

        // 単語のバリデーション
        const wordValidation = validateWord(word);
        if (!wordValidation.valid) {
            return message.reply(`❌ ${wordValidation.error}`);
        }
        const validatedWord = wordValidation.value;

        const type = (typeArg === 'gray' || typeArg === 'g') ? 'GRAY' : 'BLACK';

        db.prepare('INSERT OR REPLACE INTO banned_words (word, type) VALUES (?, ?)').run(validatedWord, type);
        loadBannedWords();
        message.reply(`✅ 追加: **${validatedWord}** (${type})`);

        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'ADDWORD',
            userId: message.author.id,
            moderatorId: message.author.id,
            timestamp: Date.now(),
            reason: `単語追加: ${validatedWord} (${type})`,
            content: word,
            contextData: '',
            aiAnalysis: null
        });
    }

    if (command === 'removeword') {
        const word = args[0];
        if (!word) return message.reply('❌ `!removeword <単語>`');

        // 単語のバリデーション
        const wordValidation = validateWord(word);
        if (!wordValidation.valid) {
            return message.reply(`❌ ${wordValidation.error}`);
        }
        const validatedWord = wordValidation.value;

        const result = db.prepare('DELETE FROM banned_words WHERE word = ?').run(validatedWord);
        if (result.changes === 0) {
            return message.reply(`❌ 単語「${word}」が見つかりませんでした`);
        }

        loadBannedWords();
        message.reply(`✅ 削除: ${word}`);

        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'REMOVEWORD',
            userId: message.author.id,
            moderatorId: message.author.id,
            timestamp: Date.now(),
            reason: `単語削除: ${word}`,
            content: word,
            contextData: '',
            aiAnalysis: null
        });
    }

    if (command === 'timeout_user') {
        const userId = args[0];
        if (!userId) return message.reply('❌ ユーザーIDを指定してください: `!timeout_user <ユーザーID>`');

        // ユーザーIDのバリデーション
        const userIdValidation = validateUserId(userId);
        if (!userIdValidation.valid) {
            return message.reply(`❌ ${userIdValidation.error}`);
        }

        const mem = await message.guild.members.fetch(userId).catch(() => null);
        if (!mem) return message.reply('❌ ユーザーが見つかりません');

        if (isAdminUser(mem)) {
            return message.reply('❌ 管理者をタイムアウトすることはできません');
        }

        try {
            await mem.timeout(CONFIG.TIMEOUT_DURATION, `手動タイムアウト by ${message.author.tag}`);
            message.reply(`🔨 ${mem.user} をタイムアウトしました (${CONFIG.TIMEOUT_DURATION / 1000 / 60}分)`);

            const logId = Date.now().toString(36);
            saveModLog({
                id: logId,
                type: 'TIMEOUT',
                userId: userId,
                moderatorId: message.author.id,
                timestamp: Date.now(),
                reason: '手動タイムアウト',
                content: '',
                contextData: '',
                aiAnalysis: null
            });
        } catch (e) {
            message.reply(`❌ タイムアウトの実行に失敗しました: ${e.message}`);
        }
    }

    if (command === 'cmdlog') {
        // 件数のバリデーション
        const limitValidation = validateNumber(args[0] || 10, 1, 50, '件数');
        if (!limitValidation.valid) {
            return message.reply(`❌ ${limitValidation.error}`);
        }
        const limit = limitValidation.value;
        const logs = db.prepare('SELECT * FROM command_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?').all(message.guild.id, limit);

        if (logs.length === 0) {
            return message.reply('📝 コマンド履歴がありません');
        }

        const warnLogs = logs.filter(log => log.command === 'warn' && log.success === 1);
        const warnFrequency = {};
        warnLogs.forEach(log => {
            const args = JSON.parse(log.args || '[]');
            const targetId = args[0]?.replace(/[<@!>]/g, '') || 'unknown';
            if (!warnFrequency[targetId]) {
                warnFrequency[targetId] = { count: 0, times: [] };
            }
            warnFrequency[targetId].count++;
            warnFrequency[targetId].times.push(log.timestamp);
        });

        const logText = logs.map(log => {
            const user = message.guild.members.cache.get(log.user_id);
            const date = new Date(log.timestamp).toLocaleString('ja-JP', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const args = JSON.parse(log.args || '[]');
            const argsText = args.length > 0 ? args.join(' ') : '';
            const commandText = argsText ? `${CONFIG.PREFIX}${log.command} ${argsText}` : `${CONFIG.PREFIX}${log.command}`;
            return `\`${date}\` **${user?.user?.tag || log.user_id}**: \`${commandText}\` ${log.success ? '✅' : '❌'}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📝 コマンド履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: `最新${logs.length}件表示` });

        const frequentWarns = Object.entries(warnFrequency).filter(([_, data]) => data.count >= 2);
        if (frequentWarns.length > 0) {
            const warnText = frequentWarns.map(([targetId, data]) => {
                const target = message.guild.members.cache.get(targetId);
                const timeDiff = Math.max(...data.times) - Math.min(...data.times);
                const minutes = Math.floor(timeDiff / 60000);
                return `**${target?.user?.tag || targetId}**: ${data.count}回 (${minutes}分以内)`;
            }).join('\n');

            embed.addFields({
                name: '⚠️ 警告頻度が高いユーザー',
                value: warnText.length > 1024 ? warnText.substring(0, 1024) + '...' : warnText || 'なし',
                inline: false
            });
        }

        message.reply({ embeds: [embed] });
    }

    if (command === 'warnlog') {
        const targetIdRaw = args[0]?.replace(/[<@!>]/g, '');

        // ユーザーIDのバリデーション（指定されている場合）
        let targetId = null;
        if (targetIdRaw) {
            const userIdValidation = validateUserId(targetIdRaw);
            if (!userIdValidation.valid) {
                return message.reply(`❌ ${userIdValidation.error}`);
            }
            targetId = targetIdRaw;
        }

        // 件数のバリデーション
        const limitValidation = validateNumber(args[1] || 10, 1, 50, '件数');
        if (!limitValidation.valid) {
            return message.reply(`❌ ${limitValidation.error}`);
        }
        const limit = limitValidation.value;

        let logs;
        if (targetId) {
            logs = db.prepare('SELECT * FROM mod_logs WHERE user_id = ? AND type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all(targetId, 'WARN%', limit);
        } else {
            logs = db.prepare('SELECT * FROM mod_logs WHERE type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all('WARN%', limit);
        }

        if (logs.length === 0) {
            return message.reply('📝 警告履歴がありません');
        }

        const logText = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('ja-JP', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            const moderator = message.guild.members.cache.get(log.moderator_id);
            const target = message.guild.members.cache.get(log.user_id);
            return `\`${date}\` ${target?.user?.tag || log.user_id} ← ${moderator?.user?.tag || log.moderator_id}\n理由: ${log.reason}\nID: \`${log.id}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('⚠️ 警告履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: targetId ? `対象: ${targetId}` : `最新${logs.length}件` });

        message.reply({ embeds: [embed] });
    }

    if (command === 'health' && isAdmin) {
        const detailed = args[0] === 'detailed';
        const health = detailed ? checkHealthDetailed() : checkHealth();

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💚 ヘルスチェック')
            .addFields(
                { name: 'ステータス', value: health.status, inline: true },
                { name: '稼働時間', value: health.uptimeFormatted, inline: true },
                { name: 'メモリ使用率', value: health.memory.usagePercent, inline: true },
                { name: 'メモリ使用量', value: `${health.memory.heapUsed} / ${health.memory.heapTotal}`, inline: false },
                { name: 'キャッシュ', value: `保留中の警告: ${health.cache.pendingWarns}件`, inline: true },
                { name: 'データベース', value: health.database.connected ? '✅ 接続中' : '❌ 切断', inline: true }
            )
            .setFooter({ text: `Node.js ${health.node.version} | ${health.platform} ${health.node.arch}` })
            .setTimestamp(new Date(health.timestamp));

        if (detailed && health.database.stats) {
            embed.addFields(
                { name: 'データベース統計', value: `警告: ${health.database.stats.warnings}件\n警告レコード: ${health.database.stats.warningRecords}件\nモデレーションログ: ${health.database.stats.modLogs}件\n禁止ワード: ${health.database.stats.bannedWords}件\nコマンドログ: ${health.database.stats.commandLogs}件`, inline: false }
            );
        }

        message.reply({ embeds: [embed] });
    }
}

module.exports = { handleCommand, executeManualWarn };

