require('dotenv').config();

// loggerは後で読み込む（循環参照を避けるため）
let logger;
try {
    logger = require('./utils/logger');
} catch (e) {
    // loggerがまだ利用できない場合はconsoleを使用
    logger = {
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.log.bind(console),
        debug: () => {}
    };
}

// 環境変数バリデーション関数
function validateEnvVar(name, value, validator = null) {
    if (!value || value.trim() === '') {
        return { valid: false, error: `${name} が設定されていません` };
    }
    
    if (validator && !validator(value)) {
        return { valid: false, error: `${name} の形式が正しくありません` };
    }
    
    return { valid: true };
}

// Discord ID形式チェック（18-19桁の数字）
function isValidDiscordId(id) {
    return /^\d{17,19}$/.test(id);
}

// 環境変数チェックとバリデーション
const requiredVars = [
    { name: 'BOT_TOKEN', validator: (v) => v.length > 50 }, // Discordトークンは長い
    { name: 'GEMINI_API_KEY', validator: (v) => v.length > 20 }, // APIキーはある程度の長さ
    { name: 'DISCORD_GUILD_ID', validator: isValidDiscordId },
    { name: 'DISCORD_ADMIN_ROLE_ID', validator: isValidDiscordId },
    { name: 'DISCORD_ALERT_CHANNEL_ID', validator: isValidDiscordId },
    { name: 'DISCORD_TICKET_CATEGORY_ID', validator: isValidDiscordId }
];

const missing = [];
const invalid = [];

for (const { name, validator } of requiredVars) {
    const value = process.env[name];
    const result = validateEnvVar(name, value, validator);
    
    if (!result.valid) {
        if (!value) {
            missing.push(name);
        } else {
            invalid.push({ name, error: result.error });
        }
    }
}

if (missing.length > 0 || invalid.length > 0) {
    logger.error('❌ 環境変数の設定に問題があります');
    if (missing.length > 0) {
        logger.error(`不足している変数: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
        invalid.forEach(({ name, error }) => {
            logger.error(`${name}: ${error}`);
        });
    }
    logger.error('README.md または .env.example を確認してください。');
    process.exit(1);
}

// 設定オブジェクト
const CONFIG = {
    PREFIX: process.env.COMMAND_PREFIX || "!",
    WARN_THRESHOLD: parseInt(process.env.WARN_THRESHOLD) || 3,
    TIMEOUT_DURATION: parseInt(process.env.TIMEOUT_DURATION) || 60 * 60 * 1000, 

    ALLOWED_GUILD_ID: process.env.DISCORD_GUILD_ID, 
    ADMIN_USER_IDS: process.env.DISCORD_ADMIN_USER_IDS ? process.env.DISCORD_ADMIN_USER_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0) : [], 
    ADMIN_ROLE_ID: process.env.DISCORD_ADMIN_ROLE_ID, 
    
    ALERT_CHANNEL_ID: process.env.DISCORD_ALERT_CHANNEL_ID, 
    TICKET_CATEGORY_ID: process.env.DISCORD_TICKET_CATEGORY_ID, 

    // Gemini API設定
    GEMINI_API_URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, 
    GEMINI_CREDIT: "🛡️ AI Analysis Powered by Google Gemini",
    GEMINI_ICON: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg",
    
    // セキュリティ設定
    COMMAND_RATE_LIMIT: parseInt(process.env.COMMAND_RATE_LIMIT) || 5, 
    COMMAND_RATE_WINDOW: parseInt(process.env.COMMAND_RATE_WINDOW) || 60 * 1000, 
    WARN_CONTEXT_BEFORE: 10, 
    WARN_CONTEXT_AFTER: 10,
    
    // 長文・連投検出設定
    MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH) || 2000, 
    SPAM_MESSAGE_COUNT: parseInt(process.env.SPAM_MESSAGE_COUNT) || 5, 
    SPAM_TIME_WINDOW: parseInt(process.env.SPAM_TIME_WINDOW) || 10 * 1000, 
    MUTE_DURATION: parseInt(process.env.MUTE_DURATION) || 30 * 60 * 1000,
    
    // AIモード設定
    AI_MODE: process.env.AI_MODE || 'free', // 'free' or 'full'
    
    // 信用スコア設定
    TRUST_SCORE_MIN: 0,
    TRUST_SCORE_MAX: 100,
    TRUST_SCORE_DEFAULT: 50,
    
    // AI確認フロー設定
    AI_CONFIRMATION_ENABLED: process.env.AI_MODE === 'full',
    
    // ソフト警告設定
    SOFT_WARNING_ENABLED: process.env.AI_MODE === 'full',
    
    // 荒らし検知設定
    TROLL_PATTERN_DETECTION_ENABLED: process.env.AI_MODE === 'full',
    
    // AIチケット応答設定
    AI_TICKET_RESPONSE_ENABLED: process.env.AI_MODE === 'full',
    
    // 危険ワード自動学習設定
    AUTO_WORD_LEARNING_ENABLED: process.env.AI_MODE === 'full',
    
    // 警告システム設定
    WARNING_EXPIRY_DAYS: parseInt(process.env.WARNING_EXPIRY_DAYS) || 30, // 警告の有効期限（日数）
    
    // 衝突調停設定
    CONFLICT_CHECK_PROBABILITY: parseFloat(process.env.CONFLICT_CHECK_PROBABILITY) || 0.1, // 衝突調停チェックの確率（10%）
    
    // キャッシュ設定
    PENDING_WARNS_CACHE_TTL: parseInt(process.env.PENDING_WARNS_CACHE_TTL) || 5 * 60 * 1000, // 保留中の警告キャッシュのTTL（ミリ秒、デフォルト5分）
    CACHE_CLEANUP_INTERVAL: parseInt(process.env.CACHE_CLEANUP_INTERVAL) || 60 * 1000, // キャッシュクリーンアップ間隔（ミリ秒、デフォルト1分）
    
    // 異議申し立て設定
    APPEAL_DEADLINE_DAYS: parseInt(process.env.APPEAL_DEADLINE_DAYS) || 3 // 異議申し立ての期限（日数）
};

// 設定値の妥当性チェック
function validateConfig() {
    const errors = [];
    
    if (CONFIG.WARN_THRESHOLD < 1 || CONFIG.WARN_THRESHOLD > 100) {
        errors.push('WARN_THRESHOLD は 1-100 の範囲である必要があります');
    }
    
    if (CONFIG.MAX_MESSAGE_LENGTH < 100 || CONFIG.MAX_MESSAGE_LENGTH > 10000) {
        errors.push('MAX_MESSAGE_LENGTH は 100-10000 の範囲である必要があります');
    }
    
    if (CONFIG.SPAM_MESSAGE_COUNT < 1 || CONFIG.SPAM_MESSAGE_COUNT > 100) {
        errors.push('SPAM_MESSAGE_COUNT は 1-100 の範囲である必要があります');
    }
    
    if (CONFIG.COMMAND_RATE_LIMIT < 1 || CONFIG.COMMAND_RATE_LIMIT > 100) {
        errors.push('COMMAND_RATE_LIMIT は 1-100 の範囲である必要があります');
    }
    
    // CONFLICT_CHECK_PROBABILITY の範囲チェック（0.0-1.0）
    if (CONFIG.CONFLICT_CHECK_PROBABILITY < 0.0 || CONFIG.CONFLICT_CHECK_PROBABILITY > 1.0) {
        errors.push('CONFLICT_CHECK_PROBABILITY は 0.0-1.0 の範囲である必要があります');
    }
    
    // CACHE_CLEANUP_INTERVAL の範囲チェック（最小1秒、最大1時間）
    if (CONFIG.CACHE_CLEANUP_INTERVAL < 1000 || CONFIG.CACHE_CLEANUP_INTERVAL > 60 * 60 * 1000) {
        errors.push('CACHE_CLEANUP_INTERVAL は 1000-3600000 ミリ秒（1秒-1時間）の範囲である必要があります');
    }
    
    // PENDING_WARNS_CACHE_TTL の範囲チェック（最小1分、最大24時間）
    if (CONFIG.PENDING_WARNS_CACHE_TTL < 60 * 1000 || CONFIG.PENDING_WARNS_CACHE_TTL > 24 * 60 * 60 * 1000) {
        errors.push('PENDING_WARNS_CACHE_TTL は 60000-86400000 ミリ秒（1分-24時間）の範囲である必要があります');
    }
    
    if (errors.length > 0) {
        logger.warn('設定値の警告:', errors);
    }
}

// 起動時に設定を検証
validateConfig();

module.exports = CONFIG;

