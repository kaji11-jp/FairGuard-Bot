const Database = require('better-sqlite3');
const { encrypt, decrypt, loadEncryptionKey } = require('./utils/encryption');

// ロガーは後で読み込む（循環参照を避けるため）
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
        error: (...args) => console.error('DB ERROR:', ...args.map(arg => sanitizeOutput(arg))),
        warn: (...args) => console.warn('DB WARN:', ...args.map(arg => sanitizeOutput(arg))),
        info: (...args) => console.log('DB INFO:', ...args.map(arg => sanitizeOutput(arg))),
        debug: () => { }
    };
}

// データベース初期化（エラーハンドリング付き）
let db;
try {
    // 暗号化キーの事前ロードと検証
    loadEncryptionKey();

    db = new Database('bot_data.sqlite', {
        verbose: process.env.NODE_ENV === 'development' ? logger.debug.bind(logger) : null
    });

    // WALモードを有効化（パフォーマンス向上、読み取りと書き込みの並行性向上）
    db.pragma('journal_mode = WAL');

    // 外部キー制約を有効化
    db.pragma('foreign_keys = ON');

    // 接続の健全性チェック
    db.prepare('SELECT 1').get();

    logger.info('データベース接続が正常に確立されました');
} catch (error) {
    logger.error('データベース初期化エラー', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
}

// 暗号化対象のフィールド定義
const ENCRYPTED_FIELDS = {
    warning_records: ['reason', 'moderator_id', 'log_id'],
    mod_logs: ['reason', 'content', 'context_data', 'ai_analysis', 'moderator_id'],
    command_logs: ['args'],
    ai_confirmations: ['ai_analysis', 'context_data', 'moderator_id'],
    soft_warnings: ['suggestion'],
    troll_patterns: ['pattern_data'],
    ai_ticket_responses: ['initial_questions', 'ai_summary'],
    server_rules: ['content']
};

/**
 * SQLクエリからテーブル名を推測するヘルパー関数
 * 簡易的な正規表現で、FROM句またはINSERT INTO句の直後の単語をテーブル名とみなす
 */
function inferTableName(sql) {
    let match = sql.match(/(?:FROM|INSERT INTO|UPDATE)\s+([a-zA-Z_]+)/i);
    return match ? match[1].toLowerCase() : null;
}

// db.prepareをラップして暗号化・復号化を自動で適用する
const originalPrepare = db.prepare;
db.prepare = function (sql) {
    const stmt = originalPrepare.call(this, sql);
    const tableName = inferTableName(sql);
    const fieldsToEncrypt = ENCRYPTED_FIELDS[tableName] || [];

    // 元のメソッドを保存
    const originalRun = stmt.run;
    const originalGet = stmt.get;
    const originalAll = stmt.all;

    // INSERT/UPDATE操作用のラッパー
    stmt.run = function (...params) {
        if (fieldsToEncrypt.length > 0) {
            // paramsが配列の場合（一括挿入など）
            if (Array.isArray(params[0]) && params.length === 1 && typeof params[0][0] === 'object') {
                const processedParams = params[0].map(row => {
                    const newRow = { ...row };
                    for (const field of fieldsToEncrypt) {
                        if (newRow[field] !== undefined && newRow[field] !== null && newRow[field] !== '') {
                            newRow[field] = encrypt(newRow[field]);
                        }
                    }
                    return newRow;
                });
                return originalRun.call(this, processedParams);
            }
            // paramsがオブジェクトの場合（名前付きパラメータ）
            else if (typeof params[0] === 'object' && params[0] !== null) {
                const processedParams = { ...params[0] };
                for (const field of fieldsToEncrypt) {
                    if (processedParams[field] !== undefined && processedParams[field] !== null && processedParams[field] !== '') {
                        processedParams[field] = encrypt(processedParams[field]);
                    }
                }
                return originalRun.call(this, processedParams);
            }
            // paramsが配列（位置指定パラメータ）またはその他の場合
            else if (params.length > 0) {
                // `better-sqlite3`では、通常、位置指定パラメータは配列で渡される。
                // SQLクエリのパラメータを解析してどのインデックスがどのフィールドに対応するかを
                // 動的に判断するのは複雑でエラーの元になりやすい。
                // したがって、位置指定パラメータの場合は、暗号化は呼び出し元で行うことを推奨するか、
                // Named parametersに移行を推奨する。
                // ここでは、named parametersを前提とするため、位置指定パラメータの場合は
                // 暗号化処理をスキップし、WARNログを出す。
                logger.warn(`Encryption skipped for positional parameters in table ${tableName}. Consider using named parameters for automatic encryption. SQL: ${sql}`);
            }
        }
        return originalRun.apply(this, params);
    };


    // SELECT操作用のラッパー (単一結果)
    stmt.get = function (...params) {
        const result = originalGet.apply(this, params);
        if (result && fieldsToEncrypt.length > 0) {
            const decryptedResult = { ...result };
            for (const field of fieldsToEncrypt) {
                if (decryptedResult[field] !== undefined && decryptedResult[field] !== null && decryptedResult[field] !== '') {
                    try {
                        decryptedResult[field] = decrypt(decryptedResult[field]);
                    } catch (e) {
                        logger.error(`Failed to decrypt field '${field}' for table '${tableName}': ${e.message}`);
                        // 復号化失敗時は元の暗号化された値を返します
                    }
                }
            }
            return decryptedResult;
        }
        return result;
    };

    // SELECT操作用のラッパー (複数結果)
    stmt.all = function (...params) {
        const results = originalAll.apply(this, params);
        if (results && fieldsToEncrypt.length > 0) {
            return results.map(row => {
                const decryptedRow = { ...row };
                for (const field of fieldsToEncrypt) {
                    if (decryptedRow[field] !== undefined && decryptedRow[field] !== null && decryptedRow[field] !== '') {
                        try {
                            decryptedRow[field] = decrypt(decryptedRow[field]);
                        } catch (e) {
                            logger.error(`Failed to decrypt field '${field}' for table '${tableName}': ${e.message}`);
                            // 復号化失敗時は元の暗号化された値を返します
                        }
                    }
                }
                return decryptedRow;
            });
        }
        return results;
    };

    return stmt;
};


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
    CREATE TABLE IF NOT EXISTS server_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at INTEGER,
        added_by TEXT
    );
    CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
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

// データベース接続の健全性チェック関数
function checkDatabaseHealth() {
    try {
        db.prepare('SELECT 1').get();
        return true;
    } catch (error) {
        logger.error('データベース健全性チェック失敗', {
            error: error.message
        });
        return false;
    }
}

// エクスポート
module.exports = db;
module.exports.checkDatabaseHealth = checkDatabaseHealth;

