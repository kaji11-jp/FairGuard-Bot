const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');
const { isAdminUser } = require('../utils/permissions');
const { blacklistCache, graylistCache } = require('../utils/bannedWords');
const { fetchContext, callGemini } = require('../services/ai');
const { addWarning, getActiveWarningCount } = require('../services/warnings');
const { saveModLog } = require('../utils/logs');
const db = require('../database');

// 長文・連投検出（AI判定付き）
async function checkSpamAndLongMessage(message, client) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    if (isAdminUser(message.member)) return;
    
    const now = Date.now();
    const userId = message.author.id;
    const channelId = message.channel.id;
    const messageLength = message.content.length;
    
    db.prepare('INSERT INTO message_tracking (user_id, channel_id, timestamp, message_length) VALUES (?, ?, ?, ?)')
        .run(userId, channelId, now, messageLength);
    
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
        
        const result = await callGemini(prompt);
        
        if (result && result.verdict === "PUNISH") {
            const currentWarnCount = getActiveWarningCount(userId);
            
            const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            
            if (currentWarnCount < 3) {
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
                
                message.channel.send({ embeds: [embed] });
            } else {
                try {
                    await message.delete();
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
                    
                    message.channel.send({ embeds: [embed] });
                } catch (e) {
                    console.error('Spam/Long message punishment error:', e);
                }
            }
        } else {
            console.log(`[SAFE] ${message.author.tag}: ${isLongMessage ? '長文' : ''}${isSpamCandidate ? '連投' : ''} -> ${result?.reason || 'AI判定なし'}`);
        }
    }
    
    const oneHourAgo = now - (60 * 60 * 1000);
    db.prepare('DELETE FROM message_tracking WHERE timestamp < ?').run(oneHourAgo);
}

// モデレーションロジック (AIハイブリッド)
async function handleModeration(message, client) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    if (isAdminUser(message.member)) return;
    
    const content = message.content.toLowerCase();
    
    // A. ブラックリスト (即死)
    for (const word of blacklistCache) {
        if (content.includes(word)) {
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
        const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
        
        const prompt = `
あなたは公平なモデレーターAIです。以下の[対象発言]が、文脈において「処罰すべき攻撃的発言」か判定してください。

【重要：判定ルール】
1. **メタ発言の保護**: 禁止ワードそのものについて語っている場合（例：「『死ね』は良くない」）は【SAFE】です。
2. **私情の排除**: 過去の文脈でユーザーが態度が悪かったとしても、今回の発言自体が無害なら【SAFE】としてください。
3. **UNSAFEの条件**: 明確に他者を傷つける意図で使用している場合。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"verdict": "SAFE" or "UNSAFE", "reason": "日本語で短い理由を記述"}

[文脈]: ${context}
[対象発言]: ${message.content}
        `;

        const result = await callGemini(prompt);
        if (result && result.verdict === "UNSAFE") {
            await executePunishment(message, "AI_JUDGE", grayMatch, result.reason, context, result, client);
        } else {
            console.log(`[SAFE] ${message.author.tag}: ${grayMatch} -> ${result?.reason}`);
        }
    }
}

async function executePunishment(message, type, word, reason, context, aiResult, client) {
    const { addWarning, getActiveWarningCount } = require('../services/warnings');
    const { saveModLog } = require('../utils/logs');
    const { EmbedBuilder } = require('discord.js');
    
    const logId = Date.now().toString(36);
    
    const currentWarnCount = getActiveWarningCount(message.author.id);
    
    saveModLog({
        id: logId, type: type, userId: message.author.id, moderatorId: client.user.id,
        timestamp: Date.now(), reason: reason, content: message.content, 
        contextData: context, aiAnalysis: aiResult ? JSON.stringify(aiResult) : null
    });
    
    const warnCount = addWarning(message.author.id, reason, client.user.id, logId);
    
    if (currentWarnCount < 3) {
        const embed = new EmbedBuilder()
            .setColor(type === 'BLACKLIST' ? '#ff9900' : '#FF9900')
            .setTitle(type === 'BLACKLIST' ? '⚠️ 警告 (禁止ワード)' : '⚡ AI警告')
            .setDescription(`${message.author} の発言が検知されました。`)
            .addFields(
                { name: '検知ワード', value: `\`${word}\``, inline: true },
                { name: '理由', value: reason, inline: true },
                { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
            );

        if (aiResult) {
            embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
        }

        message.channel.send({ embeds: [embed] });
    } else {
        try { await message.delete(); } catch {}
        
        const embed = new EmbedBuilder()
            .setColor(type === 'BLACKLIST' ? '#ff0000' : '#FF4500')
            .setTitle(type === 'BLACKLIST' ? '🚫 警告 (自動削除)' : '⚡ AI警告 (削除)')
            .setDescription(`${message.author} の発言は削除されました。`)
            .addFields(
                { name: '検知ワード', value: `\`${word}\``, inline: true },
                { name: '理由', value: reason, inline: true },
                { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
            );

        if (aiResult) {
            embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
        }

        message.channel.send({ embeds: [embed] });
    }

    if (warnCount >= CONFIG.WARN_THRESHOLD) {
        const alertCh = message.guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
        if (alertCh) alertCh.send(`🚨 **要レビュー**: ${message.author} が警告閾値に達しました。`);
    }
}

module.exports = {
    checkSpamAndLongMessage,
    handleModeration
};

