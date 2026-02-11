const db = require('../database');
const CONFIG = require('../config');
const logger = require('../utils/logger');

// 設定キャッシュ（DBアクセスを減らすため）
let settingsCache = {};
let cacheLoaded = false;

// キャッシュ有効期限（設定変更がない限り無期限だが、念のため定期リロード）
const CACHE_TTL = 5 * 60 * 1000; // 5分
let lastCacheUpdate = 0;

class ConfigManager {
    constructor() {
        this.loadSettings();
    }

    // 全設定をロードしてキャッシュ
    loadSettings() {
        try {
            const rows = db.prepare('SELECT key, value FROM bot_settings').all();
            settingsCache = {};
            rows.forEach(row => {
                settingsCache[row.key] = row.value;
            });
            cacheLoaded = true;
            lastCacheUpdate = Date.now();
            // logger.debug('設定をDBからロードしました', { count: rows.length });
        } catch (error) {
            logger.error('設定ロードエラー', { error: error.message });
        }
    }

    // 設定値を取得（DB優先 -> 環境変数/config.jsのデフォルト）
    get(key) {
        // キャッシュが古い、またはロードされていない場合はロード
        if (!cacheLoaded || Date.now() - lastCacheUpdate > CACHE_TTL) {
            this.loadSettings();
        }

        // DBに設定があればそれを使用
        if (settingsCache.hasOwnProperty(key)) {
            return settingsCache[key];
        }

        // なければ config.js の値を返す
        return CONFIG[key];
    }

    // 設定値を保存（DBに書き込み + キャッシュ更新）
    set(key, value) {
        try {
            const stmt = db.prepare(`
                INSERT INTO bot_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            `);

            stmt.run(key, String(value), Date.now());

            // キャッシュ更新
            settingsCache[key] = String(value);

            logger.info('設定を更新しました', { key, value });
            return true;
        } catch (error) {
            logger.error('設定保存エラー', { key, value, error: error.message });
            return false;
        }
    }

    // 設定値を削除（DBから削除 + キャッシュ更新） -> デフォルトに戻る
    delete(key) {
        try {
            db.prepare('DELETE FROM bot_settings WHERE key = ?').run(key);
            delete settingsCache[key];
            logger.info('設定を削除しました（デフォルトに戻ります）', { key });
            return true;
        } catch (error) {
            logger.error('設定削除エラー', { key, error: error.message });
            return false;
        }
    }

    // 全設定のキャッシュを強制クリア
    clearCache() {
        settingsCache = {};
        cacheLoaded = false;
    }
}

// シングルトンとしてエクスポート
module.exports = new ConfigManager();
