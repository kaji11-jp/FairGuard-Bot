const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ログディレクトリの作成
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// ログフォーマット
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// コンソール用フォーマット（開発時用）
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// ロガーの作成
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'fairguard-bot' },
    transports: [
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
    ],
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

// ログローテーション（古いログを削除）
function cleanupOldLogs() {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30日
    const files = fs.readdirSync(logDir);
    const now = Date.now();
    
    files.forEach(file => {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath);
            logger.info(`古いログファイルを削除: ${file}`);
        }
    });
}

// 起動時に古いログをクリーンアップ
cleanupOldLogs();

// 定期的にクリーンアップ（1日1回）
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

module.exports = logger;

