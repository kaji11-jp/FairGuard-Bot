const db = require('../database');
const { checkDatabaseHealth } = require('../database');
const { pendingWarnsCache } = require('./cache');

/**
 * ヘルスチェック情報を取得
 * @returns {Object} ヘルスチェック情報
 */
function checkHealth() {
    const memoryUsage = process.memoryUsage();
    
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        uptimeFormatted: formatUptime(process.uptime()),
        memory: {
            rss: formatBytes(memoryUsage.rss),
            heapTotal: formatBytes(memoryUsage.heapTotal),
            heapUsed: formatBytes(memoryUsage.heapUsed),
            external: formatBytes(memoryUsage.external),
            usagePercent: ((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100).toFixed(2) + '%'
        },
        cache: {
            pendingWarns: pendingWarnsCache.size(),
            pendingWarnsMaxSize: 'unlimited'
        },
        database: {
            connected: checkDatabaseHealth()
        },
        node: {
            version: process.version,
            platform: process.platform,
            arch: process.arch
        }
    };
}

/**
 * 詳細なヘルスチェック（データベース統計を含む）
 * @returns {Object} 詳細なヘルスチェック情報
 */
function checkHealthDetailed() {
    const basic = checkHealth();
    
    try {
        const stats = {
            warnings: db.prepare('SELECT COUNT(*) as count FROM warnings').get()?.count || 0,
            warningRecords: db.prepare('SELECT COUNT(*) as count FROM warning_records').get()?.count || 0,
            modLogs: db.prepare('SELECT COUNT(*) as count FROM mod_logs').get()?.count || 0,
            bannedWords: db.prepare('SELECT COUNT(*) as count FROM banned_words').get()?.count || 0,
            commandLogs: db.prepare('SELECT COUNT(*) as count FROM command_logs').get()?.count || 0
        };
        
        return {
            ...basic,
            database: {
                ...basic.database,
                stats
            }
        };
    } catch (error) {
        return {
            ...basic,
            database: {
                ...basic.database,
                error: error.message
            }
        };
    }
}

/**
 * バイト数を読みやすい形式に変換
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 秒数を読みやすい形式に変換
 * @param {number} seconds 
 * @returns {string}
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}日`);
    if (hours > 0) parts.push(`${hours}時間`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`);
    
    return parts.join(' ');
}

module.exports = {
    checkHealth,
    checkHealthDetailed
};

