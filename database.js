const Database = require('better-sqlite3');

// データベース初期化
const db = new Database('bot_data.sqlite');

// テーブル作成
db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (user_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS warning_records (
        id TEXT PRIMARY KEY, user_id TEXT, timestamp INTEGER, expires_at INTEGER, 
        reason TEXT, moderator_id TEXT, log_id TEXT
    );
    CREATE TABLE IF NOT EXISTS mod_logs (
        id TEXT PRIMARY KEY, type TEXT, user_id TEXT, moderator_id TEXT, 
        timestamp INTEGER, reason TEXT, content TEXT, context_data TEXT, 
        ai_analysis TEXT, is_resolved INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tickets (user_id TEXT PRIMARY KEY, channel_id TEXT);
    CREATE TABLE IF NOT EXISTS banned_words (word TEXT PRIMARY KEY, type TEXT DEFAULT 'BLACK');
    CREATE TABLE IF NOT EXISTS command_rate_limits (user_id TEXT PRIMARY KEY, last_command_time INTEGER, command_count INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS command_logs (
        id TEXT PRIMARY KEY, user_id TEXT, command TEXT, args TEXT, 
        timestamp INTEGER, guild_id TEXT, channel_id TEXT, success INTEGER
    );
    CREATE TABLE IF NOT EXISTS message_tracking (
        user_id TEXT, channel_id TEXT, timestamp INTEGER, message_length INTEGER,
        PRIMARY KEY (user_id, channel_id, timestamp)
    );
    CREATE TABLE IF NOT EXISTS user_trust_scores (
        user_id TEXT PRIMARY KEY, score INTEGER DEFAULT 50, 
        last_updated INTEGER, warning_count INTEGER DEFAULT 0,
        spam_tendency REAL DEFAULT 0, join_date INTEGER
    );
    CREATE TABLE IF NOT EXISTS ai_confirmations (
        id TEXT PRIMARY KEY, message_id TEXT, user_id TEXT, 
        moderator_id TEXT, status TEXT, timestamp INTEGER,
        ai_analysis TEXT, context_data TEXT
    );
    CREATE TABLE IF NOT EXISTS soft_warnings (
        id TEXT PRIMARY KEY, user_id TEXT, message_id TEXT,
        timestamp INTEGER, tone_score REAL, suggestion TEXT
    );
    CREATE TABLE IF NOT EXISTS troll_patterns (
        id TEXT PRIMARY KEY, pattern_type TEXT, pattern_data TEXT,
        detected_count INTEGER, last_detected INTEGER
    );
    CREATE TABLE IF NOT EXISTS word_learning_candidates (
        word TEXT PRIMARY KEY, frequency INTEGER, danger_score REAL,
        suggested_type TEXT, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS ai_ticket_responses (
        ticket_id TEXT PRIMARY KEY, user_id TEXT, initial_questions TEXT,
        ai_summary TEXT, status TEXT, created_at INTEGER
    );
`);

// パフォーマンス向上のためのインデックス作成
db.exec(`
    -- warning_records: 警告数の取得で頻繁に使用される(user_id, expires_at)の組み合わせ
    CREATE INDEX IF NOT EXISTS idx_warning_records_user_expires 
    ON warning_records(user_id, expires_at);
    
    -- mod_logs: 警告履歴の取得で使用される(user_id, timestamp)の組み合わせ
    CREATE INDEX IF NOT EXISTS idx_mod_logs_user_timestamp 
    ON mod_logs(user_id, timestamp);
    
    -- mod_logs: タイプ別のログ検索で使用される(type, timestamp)の組み合わせ
    CREATE INDEX IF NOT EXISTS idx_mod_logs_type_timestamp 
    ON mod_logs(type, timestamp);
    
    -- message_tracking: スパム検出で使用される(user_id, channel_id, timestamp)の組み合わせ
    -- PRIMARY KEYが既にあるが、クエリパターンに合わせて追加のインデックスを作成
    CREATE INDEX IF NOT EXISTS idx_message_tracking_user_channel_time 
    ON message_tracking(user_id, channel_id, timestamp);
    
    -- mod_logs: 異議申し立てで使用されるis_resolvedとtimestampの組み合わせ
    CREATE INDEX IF NOT EXISTS idx_mod_logs_resolved_timestamp 
    ON mod_logs(is_resolved, timestamp);
`);

module.exports = db;

