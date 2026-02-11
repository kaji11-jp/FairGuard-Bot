const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');
const { callGemini, fetchContext } = require('./ai');

// AI荒らし誘惑防止システム（ファシリテーター）
async function mediateConflict(channel, recentMessages) {
    if (CONFIG.AI_MODE !== 'full') {
        return null;
    }
    
    // 最近のメッセージを分析
    const messages = recentMessages.slice(-10).map(m => `[${m.author.tag}]: ${m.content}`).join('\n');
    
    const prompt = `
あなたはコミュニティファシリテーターAIです。以下の会話を分析し、攻撃的な言い合いや誤解が生じている可能性があるか判定してください。

【判定基準】
1. **攻撃的な言い合い**: お互いを非難し合っている
2. **誤解の可能性**: お互いの意図を誤解している可能性
3. **エスカレート**: 会話がエスカレートしている

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"needs_mediation": true or false, "issue_type": "問題のタイプ", "mediation_message": "ファシリテーション用のメッセージ", "suggestions": ["提案1", "提案2"]}

[最近の会話]: ${messages}
    `;
    
    const result = await callGemini(prompt);
    if (!result || !result.needs_mediation) {
        return null;
    }
    
    const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('🤝 会話のファシリテーション')
        .setDescription(result.mediation_message)
        .addFields(
            { name: '問題のタイプ', value: result.issue_type, inline: false },
            { name: '提案', value: result.suggestions?.join('\n') || 'なし', inline: false }
        )
        .setFooter({ text: 'AIファシリテーター', iconURL: CONFIG.GEMINI_ICON });
    
    return embed;
}

module.exports = {
    mediateConflict
};

