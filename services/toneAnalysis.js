const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');
const db = require('../database');
const { callGemini, fetchContext } = require('./ai');
const logger = require('../utils/logger');

// トーン分析（ソフト警告）
async function analyzeTone(message) {
    if (!CONFIG.SOFT_WARNING_ENABLED) {
        return null;
    }
    
    const context = await fetchContext(message.channel, message.id, 5, 5);
    
    const prompt = `
あなたはコミュニケーション分析AIです。以下のメッセージの「トーン（語調）」を分析してください。

【分析基準】
1. **攻撃性**: 相手を不快にさせる可能性がある表現か
2. **毒のある言い方**: 皮肉や嫌味が含まれているか
3. **建設性**: 建設的な会話か、それとも破壊的か

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"tone_score": 0-100の数値（低いほど攻撃的）, "is_problematic": true or false, "suggestion": "改善提案の日本語メッセージ", "reason": "分析理由"}

[文脈]: ${context}
[対象発言]: ${message.content}
    `;
    
    const result = await callGemini(prompt);
    if (!result || !result.is_problematic) {
        return null;
    }
    
    // ソフト警告を記録
    try {
        const softWarningId = Date.now().toString(36);
        db.prepare(`
            INSERT INTO soft_warnings (id, user_id, message_id, timestamp, tone_score, suggestion)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(softWarningId, message.author.id, message.id, Date.now(), result.tone_score, result.suggestion);
    } catch (error) {
        logger.error('ソフト警告記録エラー', {
            userId: message.author.id,
            messageId: message.id,
            error: error.message,
            stack: error.stack
        });
    }
    
    // ユーザーに直接DMで通知（公開しない）
    try {
        const embed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('💡 メッセージのトーンについて')
            .setDescription('あなたのメッセージが相手を不快にさせる可能性があるとAIが判定しました。')
            .addFields(
                { name: '分析結果', value: result.reason, inline: false },
                { name: '改善提案', value: result.suggestion, inline: false },
                { name: 'トーンスコア', value: `${result.tone_score}/100（低いほど攻撃的）`, inline: true }
            )
            .setFooter({ text: 'これは警告ではありません。気づきを促すための通知です。', iconURL: CONFIG.GEMINI_ICON });
        
        await message.author.send({ embeds: [embed] }).catch(error => {
            logger.warn('ソフト警告DM送信失敗（ユーザーがDMを無効化している可能性）', {
                userId: message.author.id,
                messageId: message.id,
                error: error.message
            });
            // DMが送れない場合はチャンネルに送信（ephemeralは使えないので通常メッセージ）
            // ただし、これは公開されるので注意
        });
    } catch (e) {
        logger.error('ソフト警告DM送信エラー', {
            userId: message.author.id,
            messageId: message.id,
            error: e.message,
            stack: e.stack
        });
    }
    
    return result;
}

module.exports = {
    analyzeTone
};

