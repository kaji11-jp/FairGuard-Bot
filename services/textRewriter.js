const CONFIG = require('../config');
const { callGemini } = require('./ai');

// AI文章リライト（やわらかく言い換え）
async function rewriteTextSoft(originalText) {
    if (CONFIG.AI_MODE !== 'full') {
        return null;
    }
    
    const prompt = `
あなたは文章をやわらかく言い換えるAIです。以下の文章を、同じ意味を保ちながら、より丁寧で攻撃的でない表現にリライトしてください。

【リライトルール】
1. **意味を変えない**: 元の意図や内容は保持する
2. **トーンを柔らかく**: 攻撃的な表現を和らげる
3. **丁寧な表現**: 敬語や丁寧語を使用
4. **建設的な言い方**: 批判ではなく提案の形にする

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"rewritten": "リライト後の文章", "changes": ["変更点1", "変更点2", ...], "tone_improvement": "トーンの改善点"}

[元の文章]: ${originalText}
    `;
    
    const result = await callGemini(prompt);
    return result;
}

module.exports = {
    rewriteTextSoft
};

