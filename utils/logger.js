const winston = require('winston');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

// ログディレクトリの作成
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// 環境変数でログレベル・外部転送を制御
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
const LOG_WEBHOOK_LEVEL = process.env.LOG_WEBHOOK_LEVEL || 'warn';

// --- カスタムフォーマット: 機密情報のリダクション ---
const sensitiveKeys = [
    'BOT_TOKEN', 'GEMINI_API_KEY', 'ENCRYPTION_KEY', // Specific API keys
    'api_key', 'token', 'secret', // Generic keywords
    /[a-f0-9]{32,}/i, // Long hex strings (potential API keys, hashes)
    /pk_live_[a-zA-Z0-9]{24}/, // Example: Stripe Live API keys
    /sk_live_[a-zA-Z0-9]{24}/  // Example: Stripe Secret API keys
];

const redact = winston.format((info) => {
    const message = info.message;
    const meta = { ...info }; // ログメタデータのコピー

    // メッセージ内容のリダクション
    if (typeof message === 'string') {
        info.message = sensitiveKeys.reduce((acc, key) => {
            if (typeof key === 'string') {
                const regex = new RegExp(key, 'gi');
                return acc.replace(regex, '[REDACTED]');
            } else if (key instanceof RegExp) {
                return acc.replace(key, '[REDACTED]');
            }
            return acc;
        }, message);
    }

    // メタデータオブジェクト内の機密情報の検索とリダクション
    function redactObject(obj) {
        for (const prop in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                if (typeof obj[prop] === 'string') {
                    obj[prop] = sensitiveKeys.reduce((acc, key) => {
                        if (typeof key === 'string') {
                            const regex = new RegExp(key, 'gi');
                            return acc.replace(regex, '[REDACTED]');
                        } else if (key instanceof RegExp) {
                            return acc.replace(key, '[REDACTED]');
                        }
                        return acc;
                    }, obj[prop]);
                } else if (typeof obj[prop] === 'object' && obj[prop] !== null) {
                    redactObject(obj[prop]); // 再帰的に処理
                }
            }
        }
    }
    redactObject(meta); // メタデータ全体をリダクション

    return Object.assign(info, meta);
});


// --- カスタムフォーマット: スタックトレースのパスをリダクション (本番環境のみ) ---
const formatStackTrace = winston.format((info) => {
    if (process.env.NODE_ENV === 'production' && info.stack) {
        // Absolute paths will be replaced with relative paths or a generic identifier.
        // This is a simplified approach, more robust solution might involve source maps.
        const appRoot = path.resolve(__dirname, '../'); // Assuming utils/logger.js is in /utils
        info.stack = info.stack.split('\n').map(line => {
            if (line.includes(appRoot)) {
                return line.replace(new RegExp(appRoot, 'g'), '.'); // Replace absolute path with '.'
            }
            return line;
        }).join('\n');
    }
    return info;
});

// ログフォーマット
const logFormat = winston.format.combine(
    redact(), // まずリダクション
    formatStackTrace(), // 次にスタックトレースの整形
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// コンソール用フォーマット（開発時用）
const consoleFormat = winston.format.combine(
    redact(), // 開発環境のコンソールでもリダクションを適用
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
            // metadataは既にredact()で処理されている
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// ロガーの作成
const transports = [
    // エラーログファイル
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }),
    // 全ログファイル
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    })
];

// 外部ログ転送（例: 外部ログ集約サービスやWebhook）
if (LOG_WEBHOOK_URL) {
    try {
        const url = new URL(LOG_WEBHOOK_URL);
        transports.push(new winston.transports.Http({
            level: LOG_WEBHOOK_LEVEL,
            host: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: `${url.pathname}${url.search}` || '/',
            ssl: url.protocol === 'https:'
        }));
    } catch (error) {
        // 外部転送設定が不正でもアプリを止めない
        console.error('外部ログ転送のURLが不正です。LOG_WEBHOOK_URL を確認してください。', error.message);
    }
}

const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: logFormat,
    defaultMeta: { service: 'fairguard-bot' },
    transports,
    // 未処理の例外とリジェクトをキャッチ
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'exceptions.log')
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'rejections.log')
        })
    ]
});

// 開発環境ではコンソールにも出力
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// ログローテーション（古いログを削除）- 非同期版
async function cleanupOldLogs() {
    try {
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30日
        const files = await fsPromises.readdir(logDir);
        const now = Date.now();
        
        const cleanupPromises = files.map(async (file) => {
            try {
                const filePath = path.join(logDir, file);
                const stats = await fsPromises.stat(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                    await fsPromises.unlink(filePath);
                    logger.info(`古いログファイルを削除: ${file}`);
                }
            } catch (error) {
                logger.warn(`ログファイル削除エラー: ${file}`, { error: error.message });
            }
        });
        
        await Promise.all(cleanupPromises);
    } catch (error) {
        logger.error('ログクリーンアップエラー', { error: error.message, stack: error.stack });
    }
}

// 起動時に古いログをクリーンアップ（非同期で実行、ブロッキングしない）
cleanupOldLogs().catch(error => {
    logger.error('起動時のログクリーンアップエラー', { error: error.message });
});

// 定期的にクリーンアップ（1日1回）
setInterval(() => {
    cleanupOldLogs().catch(error => {
        logger.error('定期ログクリーンアップエラー', { error: error.message });
    });
}, 24 * 60 * 60 * 1000);

module.exports = logger;
module.exports.sanitize = (input) => {
    if (typeof input !== 'string') {
        input = JSON.stringify(input); // オブジェクトを文字列に変換
    }
    return sensitiveKeys.reduce((acc, key) => {
        if (typeof key === 'string') {
            const regex = new RegExp(key, 'gi');
            return acc.replace(regex, '[REDACTED]');
        } else if (key instanceof RegExp) {
            return acc.replace(key, '[REDACTED]');
        }
        return acc;
    }, input);
};


