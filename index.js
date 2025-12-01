const { Client, GatewayIntentBits } = require('discord.js');
const CONFIG = require('./config');
const db = require('./database');
const logger = require('./utils/logger');
const { blacklistCache, graylistCache } = require('./utils/bannedWords');
const { isAdminUser } = require('./utils/permissions');
const { checkSpamAndLongMessage, handleModeration } = require('./handlers/moderation');
const { handleCommand } = require('./handlers/commands');
const { handleInteraction } = require('./handlers/interactions');

// --- メインクライアント処理 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

client.on('ready', () => {
    logger.info(`✅ Logged in as ${client.user.tag}`);
    logger.info(`🛡️  System Ready: Blacklist=${blacklistCache.size}, Graylist=${graylistCache.size}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (!message.guild) return;
    
    if (message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    
    try {
        if (message.content.startsWith(CONFIG.PREFIX)) {
            await handleCommand(message);
            return;
        }

        if (!isAdminUser(message.member)) {
            await checkSpamAndLongMessage(message, client);
        }

        if (!isAdminUser(message.member)) {
            await handleModeration(message, client);
        }
        
        // フルモード: 衝突調停（定期的にチェック）
        if (CONFIG.AI_MODE === 'full') {
            const { mediateConflict } = require('./services/conflictMediation');
            // 最近のメッセージを取得してチェック（10秒ごと）
            if (Math.random() < 0.1) { // 10%の確率でチェック（負荷軽減）
                const recentMessages = await message.channel.messages.fetch({ limit: 10 });
                const mediation = await mediateConflict(message.channel, Array.from(recentMessages.values()));
                if (mediation) {
                    await message.channel.send({ embeds: [mediation] });
                }
            }
        }
    } catch (error) {
        logger.error('メッセージ処理エラー', { 
            error: error.message,
            stack: error.stack 
        });
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        logger.error('インタラクション処理エラー', { 
            error: error.message,
            stack: error.stack 
        });
    }
});

client.login(process.env.BOT_TOKEN);
