const db = require('../database');
const CONFIG = require('../config');

// 信用スコア計算
function calculateTrustScore(userId) {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    
    // 警告数
    const warningCount = db.prepare('SELECT COUNT(*) as count FROM warning_records WHERE user_id = ? AND expires_at >= ?')
        .get(userId, now)?.count || 0;
    
    // 過去30日間のメッセージ数
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM message_tracking WHERE user_id = ? AND timestamp > ?')
        .get(userId, thirtyDaysAgo)?.count || 0;
    
    // スパム傾向（過去30日間の連投回数）
    const spamIncidents = db.prepare(`
        SELECT COUNT(*) as count FROM mod_logs 
        WHERE user_id = ? AND type IN ('SPAM', 'LONG_MESSAGE', 'SPAM_LONG') AND timestamp > ?
    `).get(userId, thirtyDaysAgo)?.count || 0;
    
    // 参加日数（最初のメッセージから）
    const firstMessage = db.prepare('SELECT MIN(timestamp) as first FROM message_tracking WHERE user_id = ?').get(userId);
    const daysSinceJoin = firstMessage?.first ? Math.floor((now - firstMessage.first) / (24 * 60 * 60 * 1000)) : 0;
    
    // スコア計算（0-100）
    let score = CONFIG.TRUST_SCORE_DEFAULT;
    
    // 警告による減点（1警告 = -10点）
    score -= warningCount * 10;
    
    // スパムによる減点（1回 = -5点）
    score -= spamIncidents * 5;
    
    // 参加日数による加点（1日 = +0.1点、最大+20点）
    score += Math.min(daysSinceJoin * 0.1, 20);
    
    // メッセージ数による加点（100メッセージ = +1点、最大+10点）
    score += Math.min(Math.floor(messageCount / 100), 10);
    
    // 0-100の範囲に制限
    score = Math.max(CONFIG.TRUST_SCORE_MIN, Math.min(CONFIG.TRUST_SCORE_MAX, Math.round(score)));
    
    // データベースに保存
    db.prepare(`
        INSERT INTO user_trust_scores (user_id, score, last_updated, warning_count, spam_tendency, join_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET 
            score = ?, last_updated = ?, warning_count = ?, spam_tendency = ?
    `).run(userId, score, now, warningCount, spamIncidents / Math.max(messageCount, 1), firstMessage?.first || now,
           score, now, warningCount, spamIncidents / Math.max(messageCount, 1));
    
    return score;
}

// 信用スコア取得
function getTrustScore(userId) {
    const row = db.prepare('SELECT score FROM user_trust_scores WHERE user_id = ?').get(userId);
    if (row) {
        return row.score;
    }
    // スコアが存在しない場合は計算
    return calculateTrustScore(userId);
}

// 信用スコア更新
function updateTrustScore(userId) {
    return calculateTrustScore(userId);
}

// 低信用スコアユーザーかチェック
function isLowTrustUser(userId, threshold = 30) {
    return getTrustScore(userId) < threshold;
}

module.exports = {
    calculateTrustScore,
    getTrustScore,
    updateTrustScore,
    isLowTrustUser
};

