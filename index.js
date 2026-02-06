// 環境変数の読み込みを最初に実行
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

// NODE_ENVのチェック
const currentEnv = process.env.NODE_ENV || 'development';
console.log(`🤖 Bot is running in ${currentEnv.toUpperCase()} environment.`);

if (currentEnv === 'development') {
    console.warn('⚠️ 開発環境モードで実行中です。本番環境ではNODE_ENVを"production"に設定してください。');
} else if (currentEnv !== 'production') {
    // developmentでもproductionでもない場合
    console.warn(`⚠️ 不明な環境設定 "${currentEnv}" で実行中です。NODE_ENVは"development"または"production"であるべきです。`);
}
let CONFIG;
try {
    CONFIG = require('./config');
    if (typeof CONFIG.validateEnv === 'function') {
        const res = CONFIG.validateEnv();
        if (res.missing?.length > 0 || res.invalid?.length > 0) {
            console.error('❌ 環境変数の設定に問題があります');
            if (res.missing?.length > 0) console.error(`不足している変数: ${res.missing.join(', ')}`);
            if (res.invalid?.length > 0) res.invalid.forEach(i => console.error(i.name ? `${i.name}: ${i.message || i.error || JSON.stringify(i)}` : JSON.stringify(i)));
            process.exit(1);
        }
    }
} catch (e) {
    console.error('致命的な設定エラー:', e.message || e);
    process.exit(1);
}
const db = require('./database');
const logger = require('./utils/logger');
const { pendingWarnsCache } = require('./utils/cache');
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

    logger.info('メッセージ受信', {
        author: message.author.tag,
        guild: message.guild?.name,
        content: message.content.substring(0, 50)
    });

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
            try {
                const { mediateConflict } = require('./services/conflictMediation');
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

// Graceful Shutdown処理
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn('既にシャットダウン処理中です');
        return;
    }

    isShuttingDown = true;
    logger.info(`${signal} シグナルを受信: グレースフルシャットダウンを開始します`);

    try {
        // キャッシュのクリーンアップ
        logger.info('キャッシュをクリーンアップ中...');
        pendingWarnsCache.clear();

        // データベースのクローズ
        logger.info('データベースをクローズ中...');
        const { checkDatabaseHealth } = require('./database');
        if (db && checkDatabaseHealth()) {
            db.close();
            logger.info('データベースをクローズしました');
        }

        // Discordクライアントのログアウト
        logger.info('Discordクライアントをログアウト中...');
        if (client && client.isReady()) {
            await client.destroy();
            logger.info('Discordクライアントをログアウトしました');
        }

        logger.info('Botが正常にシャットダウンしました');
        process.exit(0);
    } catch (error) {
        logger.error('シャットダウン処理中にエラーが発生しました', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

// シグナルハンドラー
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未処理の例外とリジェクトをキャッチ
process.on('uncaughtException', (error) => {
    logger.error('未処理の例外が発生しました', {
        error: error.message,
        stack: error.stack
    });
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('未処理のPromiseリジェクトが発生しました', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    });
    gracefulShutdown('unhandledRejection');
});
