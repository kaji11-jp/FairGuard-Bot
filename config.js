require('dotenv').config();

// 環境変数チェック
if (
    !process.env.BOT_TOKEN || 
    !process.env.GEMINI_API_KEY ||
    !process.env.DISCORD_GUILD_ID ||
    !process.env.DISCORD_ADMIN_ROLE_ID ||
    !process.env.DISCORD_ALERT_CHANNEL_ID ||
    !process.env.DISCORD_TICKET_CATEGORY_ID
) {
    console.error('❌ .env に必要な設定が不足しています。README.md または .env.example を確認してください。');
    const missing = [];
    if (!process.env.BOT_TOKEN) missing.push('BOT_TOKEN');
    if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
    if (!process.env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');
    if (!process.env.DISCORD_ADMIN_ROLE_ID) missing.push('DISCORD_ADMIN_ROLE_ID');
    if (!process.env.DISCORD_ALERT_CHANNEL_ID) missing.push('DISCORD_ALERT_CHANNEL_ID');
    if (!process.env.DISCORD_TICKET_CATEGORY_ID) missing.push('DISCORD_TICKET_CATEGORY_ID');
    console.error(`不足している変数: ${missing.join(', ')}`);
    process.exit(1);
}

// 設定オブジェクト
const CONFIG = {
    PREFIX: "!",
    WARN_THRESHOLD: 3,
    TIMEOUT_DURATION: 60 * 60 * 1000, 

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
    COMMAND_RATE_LIMIT: 5, 
    COMMAND_RATE_WINDOW: 60 * 1000, 
    WARN_CONTEXT_BEFORE: 10, 
    WARN_CONTEXT_AFTER: 10,
    
    // 長文・連投検出設定
    MAX_MESSAGE_LENGTH: 2000, 
    SPAM_MESSAGE_COUNT: 5, 
    SPAM_TIME_WINDOW: 10 * 1000, 
    MUTE_DURATION: 30 * 60 * 1000,
    
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
    AUTO_WORD_LEARNING_ENABLED: process.env.AI_MODE === 'full'
};

module.exports = CONFIG;

