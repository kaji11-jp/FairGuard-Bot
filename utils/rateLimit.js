const db = require('../database');
const CONFIG = require('../config');

// レート制限チェック
function checkRateLimit(userId) {
    const now = Date.now();
    const row = db.prepare('SELECT * FROM command_rate_limits WHERE user_id = ?').get(userId);
    
    if (!row) {
        db.prepare('INSERT INTO command_rate_limits (user_id, last_command_time, command_count) VALUES (?, ?, 1)').run(userId, now);
        return true;
    }
    
    const timeDiff = now - row.last_command_time;
    if (timeDiff > CONFIG.COMMAND_RATE_WINDOW) {
        db.prepare('UPDATE command_rate_limits SET last_command_time = ?, command_count = 1 WHERE user_id = ?').run(now, userId);
        return true;
    }
    
    if (row.command_count >= CONFIG.COMMAND_RATE_LIMIT) {
        return false; 
    }
    
    db.prepare('UPDATE command_rate_limits SET last_command_time = ?, command_count = command_count + 1 WHERE user_id = ?').run(userId, now);
    return true;
}

module.exports = { checkRateLimit };

