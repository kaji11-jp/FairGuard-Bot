// 環境変数の読み込みを最初に実行
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

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

const logger = require('./utils/logger');
const { pendingWarnsCache } = require('./utils/cache');
const db = require('./database');

// --- メインクライアント処理 ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// コマンドコレクションの初期化
client.commands = new Collection();

// ハンドラーの読み込み
require('./handlers/commandHandler')(client);
require('./handlers/eventHandler')(client); // イベントハンドラー内でイベントリスナーを登録

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
