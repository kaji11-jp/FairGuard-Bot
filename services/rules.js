const db = require('../database');
const logger = require('../utils/logger');

// ルール追加
function addRule(content, addedBy) {
    try {
        const stmt = db.prepare('INSERT INTO server_rules (content, created_at, added_by) VALUES (?, ?, ?)');
        const info = stmt.run(content, Date.now(), addedBy);
        logger.info(`ルール追加: ${content} by ${addedBy}`);
        return info.lastInsertRowid;
    } catch (error) {
        logger.error('ルール追加エラー', { error: error.message });
        throw error;
    }
}

// ルール削除
function removeRule(id) {
    try {
        const stmt = db.prepare('DELETE FROM server_rules WHERE id = ?');
        const info = stmt.run(id);
        logger.info(`ルール削除: ID ${id}`);
        return info.changes > 0;
    } catch (error) {
        logger.error('ルール削除エラー', { error: error.message });
        throw error;
    }
}

// 全ルール取得
function getRules() {
    try {
        return db.prepare('SELECT * FROM server_rules ORDER BY id ASC').all();
    } catch (error) {
        logger.error('ルール取得エラー', { error: error.message });
        return [];
    }
}

// AI用ルールテキスト取得
function getRulesText() {
    const rules = getRules();
    if (rules.length === 0) return null;
    return rules.map((r, index) => `${index + 1}. ${r.content}`).join('\n');
}

module.exports = {
    addRule,
    removeRule,
    getRules,
    getRulesText
};
