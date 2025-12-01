const db = require('../database');
const logger = require('../utils/logger');

const WARNING_EXPIRY_DAYS = 30;
const WARNING_EXPIRY_MS = WARNING_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// 有効期限切れの警告を削除（トランザクション付き）
const cleanupExpiredWarnings = () => {
    const now = Date.now();
    
    try {
        const transaction = db.transaction(() => {
            db.prepare('DELETE FROM warning_records WHERE expires_at < ?').run(now);
            
            const activeWarnings = db.prepare('SELECT user_id, COUNT(*) as count FROM warning_records WHERE expires_at >= ? GROUP BY user_id').all(now);
            
            db.prepare('DELETE FROM warnings').run();
            const updateStmt = db.prepare('INSERT INTO warnings (user_id, count) VALUES (?, ?)');
            activeWarnings.forEach(row => {
                updateStmt.run(row.user_id, row.count);
            });
        });
        
        transaction();
    } catch (error) {
        logger.error('警告クリーンアップエラー', { error: error.message, stack: error.stack });
        throw error;
    }
};

// 警告を追加（有効期限付き、トランザクション付き）
const addWarning = (userId, reason = '', moderatorId = '', logId = '') => {
    const now = Date.now();
    const expiresAt = now + WARNING_EXPIRY_MS;
    const warningId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    try {
        cleanupExpiredWarnings();
        
        // トランザクションで警告レコードと警告カウントを同時に更新
        const transaction = db.transaction(() => {
            db.prepare('INSERT INTO warning_records (id, user_id, timestamp, expires_at, reason, moderator_id, log_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(warningId, userId, now, expiresAt, reason, moderatorId, logId);
            
            const activeCount = db.prepare('SELECT COUNT(*) as count FROM warning_records WHERE user_id = ? AND expires_at >= ?')
                .get(userId, now)?.count || 0;
            
            db.prepare('INSERT INTO warnings (user_id, count) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET count = ?')
                .run(userId, activeCount, activeCount);
            
            return activeCount;
        });
        
        const activeCount = transaction();
        logger.debug('警告を追加', { userId, warningId, activeCount });
        return activeCount;
    } catch (error) {
        logger.error('警告追加エラー', { 
            userId, 
            error: error.message, 
            stack: error.stack 
        });
        throw error;
    }
};

// 警告を減らす（トランザクション付き）
const reduceWarning = (userId, amount = 1) => {
    try {
        cleanupExpiredWarnings();
        
        const transaction = db.transaction(() => {
            const toDelete = db.prepare('SELECT id FROM warning_records WHERE user_id = ? AND expires_at >= ? ORDER BY timestamp ASC LIMIT ?')
                .all(userId, Date.now(), amount);
            
            toDelete.forEach(row => {
                db.prepare('DELETE FROM warning_records WHERE id = ?').run(row.id);
            });
            
            const activeCount = db.prepare('SELECT COUNT(*) as count FROM warning_records WHERE user_id = ? AND expires_at >= ?')
                .get(userId, Date.now())?.count || 0;
            
            if (activeCount === 0) {
                db.prepare('DELETE FROM warnings WHERE user_id = ?').run(userId);
            } else {
                db.prepare('UPDATE warnings SET count = ? WHERE user_id = ?').run(activeCount, userId);
            }
            
            return activeCount;
        });
        
        const activeCount = transaction();
        logger.debug('警告を削減', { userId, amount, activeCount });
        return activeCount;
    } catch (error) {
        logger.error('警告削減エラー', { 
            userId, 
            amount,
            error: error.message, 
            stack: error.stack 
        });
        throw error;
    }
};

// 有効な警告数を取得
const getActiveWarningCount = (userId) => {
    try {
        cleanupExpiredWarnings();
        const row = db.prepare('SELECT count FROM warnings WHERE user_id = ?').get(userId);
        return row ? row.count : 0;
    } catch (error) {
        logger.error('警告数取得エラー', { 
            userId,
            error: error.message 
        });
        return 0; // エラー時は0を返す（安全側）
    }
};

module.exports = {
    addWarning,
    reduceWarning,
    getActiveWarningCount,
    cleanupExpiredWarnings
};

