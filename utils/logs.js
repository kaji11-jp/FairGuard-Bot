const db = require('../database');

// ログ保存
const saveModLog = (log) => {
    db.prepare(`INSERT INTO mod_logs (id, type, user_id, moderator_id, timestamp, reason, content, context_data, ai_analysis, is_resolved) VALUES (@id, @type, @user_id, @moderator_id, @timestamp, @reason, @content, @context_data, @ai_analysis, 0)`)
      .run({
          id: log.id,
          type: log.type,
          user_id: log.userId,
          moderator_id: log.moderatorId,
          timestamp: log.timestamp,
          reason: log.reason,
          content: log.content,
          context_data: log.contextData,
          ai_analysis: log.aiAnalysis
      });
};

// コマンドログ保存
const saveCommandLog = (userId, command, args, guildId, channelId, success = true) => {
    const logId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    db.prepare(`INSERT INTO command_logs (id, user_id, command, args, timestamp, guild_id, channel_id, success) VALUES (@id, @userId, @command, @args, @timestamp, @guildId, @channelId, @success)`)
      .run({
          id: logId,
          userId: userId,
          command: command,
          args: JSON.stringify(args),
          timestamp: Date.now(),
          guildId: guildId,
          channelId: channelId,
          success: success ? 1 : 0
      });
};

module.exports = {
    saveModLog,
    saveCommandLog
};

