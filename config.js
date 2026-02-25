require('dotenv').config();
const { readFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');

// loggerは後で読み込む（循環参照を避けるため）
let logger;
let sanitizeOutput = (input) => {
    // ログモジュールがロードできない場合のフォールバックサニタイズ
    const sensitiveKeys = [
        'BOT_TOKEN', 'GEMINI_API_KEY', 'ENCRYPTION_KEY',
        'api_key', 'token', 'secret',
        /[a-f0-9]{32,}/i
    ];
    if (typeof input !== 'string') {
        input = JSON.stringify(input);
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

try {
    const loggerModule = require('./utils/logger');
    logger = loggerModule;
    if (loggerModule.sanitize) {
        sanitizeOutput = loggerModule.sanitize;
    }
} catch (e) {
    logger = {
        error: (...args) => console.error('ERROR (Fallback Logger):', ...args.map(arg => sanitizeOutput(arg))),
        warn: (...args) => console.warn('WARN (Fallback Logger):', ...args.map(arg => sanitizeOutput(arg))),
        info: (...args) => console.log('INFO (Fallback Logger):', ...args.map(arg => sanitizeOutput(arg))),
        debug: () => { }
    };
}

// 暗号鍵を安全なソースから解決（環境変数 > ファイル > コマンド）
function resolveEncryptionKey() {
    if (process.env.ENCRYPTION_KEY) {
        return process.env.ENCRYPTION_KEY.trim();
    }

    // ファイルパスが指定されていれば読み込む（例: KMSから取得した鍵をボリュームに配置）
    if (process.env.ENCRYPTION_KEY_FILE) {
        try {
            if (existsSync(process.env.ENCRYPTION_KEY_FILE)) {
                return readFileSync(process.env.ENCRYPTION_KEY_FILE, 'utf8').trim();
            }
            logger.warn('ENCRYPTION_KEY_FILE が見つかりませんでした', { path: process.env.ENCRYPTION_KEY_FILE });
        } catch (error) {
            logger.error('ENCRYPTION_KEY_FILE の読み込みに失敗しました', { error: error.message });
        }
    }

    // コマンド実行で鍵を取得（例: AWS KMS / Azure Key Vault / GCP Secret Manager から取得するスクリプト）
    if (process.env.ENCRYPTION_KEY_COMMAND) {
        try {
            const output = execSync(process.env.ENCRYPTION_KEY_COMMAND, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const key = output.trim();
            if (key) return key;
            logger.warn('ENCRYPTION_KEY_COMMAND の出力が空です');
        } catch (error) {
            logger.error('ENCRYPTION_KEY_COMMAND の実行に失敗しました', { error: error.message });
        }
    }

    return null;
}

const resolvedKey = resolveEncryptionKey();
if (resolvedKey) {
    process.env.ENCRYPTION_KEY = resolvedKey;
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

// Discord BOT Token形式チェック (基本的な構造のみチェックし、長さは柔軟に)
function isValidDiscordBotToken(token) {
    // 3つの部分がドットで結合されていることを確認
    return /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(token);
}

// Gemini API Key形式チェック
function isValidGeminiApiKey(key) {
    // Google Gemini API Keyの一般的なパターン: "AIza"で始まり、35文字の英数字
    return /^AIza[0-9A-Za-z_-]{35}$/.test(key);
}

// Encryption Key形式チェック (32バイト=64文字のHEX)
function isValidEncryptionKey(key) {
    return /^[0-9a-fA-F]{64}$/.test(key);
}

// 環境変数チェックとバリデーション
// GEMINI_API_KEY は AI_PROVIDER に依存するためここではチェックしない
const requiredVars = [
    { name: 'BOT_TOKEN', validator: isValidDiscordBotToken },
    { name: 'ENCRYPTION_KEY', validator: isValidEncryptionKey }, // 追加
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

// Keep validation results available and non-fatal during import. Startup
// scripts can call validateEnv() and decide how to react (eg. exit).
const _validation = { missing, invalid };

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
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    GEMINI_API_URL: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent`,
    GEMINI_CREDIT: "🛡️ AI Analysis Powered by Google Gemini",
    GEMINI_ICON: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg",

    // マルチモデルAI設定
    AI_PROVIDER: (process.env.AI_PROVIDER || 'gemini').toLowerCase(), // 'gemini', 'openai', 'cerebras', 'claude'

    // OpenAI設定
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o",
    OPENAI_API_URL: process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions",

    // Cerebras (高速推論)
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    CEREBRAS_API_URL: process.env.CEREBRAS_API_URL || 'https://api.cerebras.ai/v1/chat/completions',
    CEREBRAS_MODEL: process.env.CEREBRAS_MODEL || 'llama3.1-8b',

    // Claude (Anthropic)設定
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620",
    ANTHROPIC_API_URL: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",

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
    APPEAL_DEADLINE_DAYS: parseInt(process.env.APPEAL_DEADLINE_DAYS) || 3, // 異議申し立ての期限（日数）

    // チケット設定
    TICKET_CLOSE_DELAY: parseInt(process.env.TICKET_CLOSE_DELAY) || 2000, // チケット閉鎖時の遅延時間（ミリ秒、デフォルト2秒）

    // 時間定数
    ONE_HOUR_MS: 60 * 60 * 1000, // 1時間（ミリ秒）
    THIRTY_DAYS_MS: 30 * 24 * 60 * 60 * 1000 // 30日（ミリ秒）
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

    // AIプロバイダーのバリデーション
    const validProviders = ['gemini', 'openai', 'cerebras', 'claude'];
    if (!validProviders.includes(CONFIG.AI_PROVIDER)) {
        errors.push(`AI_PROVIDER は ${validProviders.join(', ')} のいずれかである必要があります`);
    } else {
        // 選択されたプロバイダーのAPIキーチェック
        if (CONFIG.AI_PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY) {
            errors.push('Geminiを使用するには GEMINI_API_KEY が必要です');
        }
        if (CONFIG.AI_PROVIDER === 'openai' && !CONFIG.OPENAI_API_KEY) {
            errors.push('OpenAIを使用するには OPENAI_API_KEY が必要です');
        }
        if (CONFIG.AI_PROVIDER === 'cerebras' && !CONFIG.CEREBRAS_API_KEY) {
            errors.push('Cerebrasを使用するには CEREBRAS_API_KEY が必要です');
        }
        if (CONFIG.AI_PROVIDER === 'claude' && !CONFIG.ANTHROPIC_API_KEY) {
            errors.push('Claudeを使用するには ANTHROPIC_API_KEY が必要です');
        }
    }

    if (errors.length > 0) {
        logger.warn('設定値の警告:', errors);
    }
}

// 起動時に設定を検証
validateConfig();

module.exports = CONFIG;
module.exports._validation = _validation;

module.exports.validateEnv = function validateEnv() {
    return { missing: Array.from(_validation.missing), invalid: Array.from(_validation.invalid) };
};

