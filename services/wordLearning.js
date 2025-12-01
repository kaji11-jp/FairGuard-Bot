const CONFIG = require('../config');
const db = require('../database');
const { callGemini } = require('./ai');

// 危険ワード自動学習
async function analyzeWordCandidate(word, frequency) {
    if (!CONFIG.AUTO_WORD_LEARNING_ENABLED) {
        return null;
    }
    
    // 既に登録されているワードはスキップ
    const existing = db.prepare('SELECT * FROM banned_words WHERE word = ?').get(word.toLowerCase());
    if (existing) {
        return null;
    }
    
    const prompt = `
あなたは危険ワード検知AIです。以下の単語が禁止ワードとして登録すべきか判定してください。

【判定基準】
1. **攻撃性**: 他者を攻撃する意図があるか
2. **ハラスメント**: ハラスメントに該当するか
3. **不適切性**: コミュニティに不適切か

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"is_dangerous": true or false, "danger_score": 0-100の数値, "suggested_type": "BLACK" or "GRAY" or null, "reason": "判定理由"}

[単語]: ${word}
[出現頻度]: ${frequency}回
    `;
    
    const result = await callGemini(prompt);
    if (!result || !result.is_dangerous) {
        return null;
    }
    
    // 候補として保存
    db.prepare(`
        INSERT INTO word_learning_candidates (word, frequency, danger_score, suggested_type, last_seen)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(word) DO UPDATE SET 
            frequency = frequency + ?, 
            danger_score = ?,
            last_seen = ?
    `).run(word.toLowerCase(), frequency, result.danger_score, result.suggested_type, Date.now(),
           frequency, result.danger_score, Date.now());
    
    return result;
}

// 候補ワード一覧取得
function getWordCandidates(limit = 10) {
    return db.prepare(`
        SELECT * FROM word_learning_candidates 
        WHERE danger_score >= 70
        ORDER BY danger_score DESC, frequency DESC
        LIMIT ?
    `).all(limit);
}

module.exports = {
    analyzeWordCandidate,
    getWordCandidates
};

