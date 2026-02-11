const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { blacklistCache, graylistCache } = require('../utils/bannedWords');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        logger.info(`✅ Logged in as ${client.user.tag}`);
        logger.info(`🛡️  System Ready: Blacklist=${blacklistCache.size}, Graylist=${graylistCache.size}`);

        // コマンド数のログ出力
        logger.info(`📝 Loaded ${client.commands.size} commands.`);
    },
};
