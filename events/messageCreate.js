const { Events } = require('discord.js');
const CONFIG = require('../config');
const logger = require('../utils/logger');
const { isAdminUser } = require('../utils/permissions');
const { checkSpamAndLongMessage, handleModeration } = require('../handlers/moderation');
const { handleCommand } = require('../handlers/commands'); // Legacy prefix commands
const { mediateConflict } = require('../services/conflictMediation');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

        logger.info('メッセージ受信', {
            author: message.author.tag,
            guild: message.guild?.name,
            content: message.content.substring(0, 50)
        });

        if (!message.guild) return;
        if (message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;

        try {
            // プレフィックスコマンドの処理 (互換性維持)
            if (message.content.startsWith(CONFIG.PREFIX)) {
                await handleCommand(message);
                return;
            }

            // 管理者以外へのスパムチェック
            if (!isAdminUser(message.member)) {
                await checkSpamAndLongMessage(message, message.client);
            }

            // モデレーション処理
            if (!isAdminUser(message.member)) {
                await handleModeration(message, message.client);
            }

            // フルモード: 衝突調停（定期的にチェック）
            if (CONFIG.AI_MODE === 'full') {
                try {
                    // 最近のメッセージを取得してチェック（10%の確率でチェック、負荷軽減）
                    if (Math.random() < CONFIG.CONFLICT_CHECK_PROBABILITY) {
                        const recentMessages = await message.channel.messages.fetch({ limit: 10 });
                        const mediation = await mediateConflict(message.channel, Array.from(recentMessages.values()));
                        if (mediation) {
                            await message.channel.send({ embeds: [mediation] });
                        }
                    }
                } catch (error) {
                    logger.error('衝突調停処理エラー', {
                        channelId: message.channel.id,
                        error: error.message,
                        stack: error.stack
                    });
                    // エラーが発生してもメッセージ処理は続行
                }
            }
        } catch (error) {
            logger.error('メッセージ処理エラー', {
                error: error.message,
                stack: error.stack
            });
        }
    },
};
