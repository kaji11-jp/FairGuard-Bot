const db = require('../database');

// ログ保存
const saveModLog = (log) => {
    db.prepare(`INSERT INTO mod_logs (id, type, user_id, moderator_id, timestamp, reason, content, context_data, ai_analysis, is_resolved) VALUES (@id, @type, @userId, @moderatorId, @timestamp, @reason, @content, @contextData, @aiAnalysis, 0)`)
      .run(log);
};

// コマンドログ保存
const saveCommandLog = (userId, command, args, guildId, channelId, success = true) => {
    const logId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    db.prepare(`INSERT INTO command_logs (id, user_id, command, args, timestamp, guild_id, channel_id, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(logId, userId, command, JSON.stringify(args), Date.now(), guildId, channelId, success ? 1 : 0);
};

module.exports = {
    saveModLog,
    saveCommandLog
};

