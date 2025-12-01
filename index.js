const { Client, GatewayIntentBits } = require('discord.js');
const CONFIG = require('./config');
const db = require('./database');
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
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🛡️  System Ready: Blacklist=${blacklistCache.size}, Graylist=${graylistCache.size}`);
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
    } catch (error) {
        console.error('Message processing error:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        console.error('Interaction processing error:', error);
    }
});

client.login(process.env.BOT_TOKEN);
