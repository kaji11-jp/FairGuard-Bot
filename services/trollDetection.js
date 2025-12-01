const CONFIG = require('../config');
const db = require('../database');
const { callGemini } = require('./ai');

// 荒らしパターン検知
async function detectTrollPattern(userId, recentMessages) {
    if (!CONFIG.TROLL_PATTERN_DETECTION_ENABLED) {
        return null;
    }
    
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    // 過去24時間の行動を分析
    const recentLogs = db.prepare(`
        SELECT type, COUNT(*) as count FROM mod_logs 
        WHERE user_id = ? AND timestamp > ?
        GROUP BY type
    `).all(userId, oneDayAgo);
    
    const warningCount = recentLogs.find(log => log.type.includes('WARN'))?.count || 0;
    const spamCount = recentLogs.find(log => log.type.includes('SPAM'))?.count || 0;
    
    if (warningCount < 2 && spamCount < 2) {
        return null; // パターン検出の閾値に達していない
    }
    
    const messages = recentMessages.map(m => m.content).join('\n');
    
    const prompt = `
あなたは荒らしパターン検知AIです。以下のユーザーの行動パターンを分析してください。

【検知対象パターン】
1. **連続的な警告**: 短期間に複数の警告を受けている
2. **スパム行為**: 繰り返しスパムを行っている
3. **攻撃的語彙**: 特定の攻撃的な言葉を繰り返し使用
4. **意図的な混乱**: 会話を意図的に混乱させようとしている

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"is_troll": true or false, "pattern_type": "パターンタイプ（例: '連続警告', 'スパム行為', '攻撃的語彙'）", "confidence": 0-100の数値, "recommendation": "推奨アクション"}

[過去24時間の警告数]: ${warningCount}
[過去24時間のスパム検知数]: ${spamCount}
[最近の発言]: ${messages}
    `;
    
    const result = await callGemini(prompt);
    if (!result || !result.is_troll) {
        return null;
    }
    
    // パターンを記録
    const patternId = Date.now().toString(36);
    db.prepare(`
        INSERT INTO troll_patterns (id, pattern_type, pattern_data, detected_count, last_detected)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET detected_count = detected_count + 1, last_detected = ?
    `).run(patternId, result.pattern_type, JSON.stringify(result), 1, now, now);
    
    return result;
}

module.exports = {
    detectTrollPattern
};

