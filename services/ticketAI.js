const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');
const db = require('../database');
const { callGemini } = require('./ai');

// AIチケット応答（一次対応）
async function handleAITicketResponse(channel, user, initialMessage) {
    if (!CONFIG.AI_TICKET_RESPONSE_ENABLED) {
        return null;
    }
    
    const prompt = `
あなたはサポートチケットの一次対応AIです。ユーザーの問い合わせに対して、適切な質問をして情報を整理してください。

【役割】
1. **情報収集**: 必要な情報を聞き出す
2. **問題の整理**: 問題を明確にする
3. **適切な質問**: 管理者が判断しやすいように質問する

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"questions": ["質問1", "質問2", "質問3"], "summary": "現時点での問題の要約", "urgency": "low" or "medium" or "high", "category": "問題のカテゴリ"}

[ユーザーの問い合わせ]: ${initialMessage}
    `;
    
    const result = await callGemini(prompt);
    if (!result) {
        return null;
    }
    
    // チケット情報を保存
    const ticketId = channel.id;
    db.prepare(`
        INSERT INTO ai_ticket_responses (ticket_id, user_id, initial_questions, ai_summary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(ticketId, user.id, JSON.stringify(result.questions), result.summary, 'active', Date.now());
    
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🤖 AI一次対応')
        .setDescription('AIがあなたの問い合わせを分析しました。以下の質問にお答えください。')
        .addFields(
            { name: '問題の要約', value: result.summary, inline: false },
            { name: '緊急度', value: result.urgency === 'high' ? '🔴 高' : result.urgency === 'medium' ? '🟡 中' : '🟢 低', inline: true },
            { name: 'カテゴリ', value: result.category, inline: true },
            { name: '質問事項', value: result.questions.join('\n'), inline: false }
        )
        .setFooter({ text: '回答後、管理者が対応します', iconURL: CONFIG.GEMINI_ICON });
    
    return embed;
}

module.exports = {
    handleAITicketResponse
};

