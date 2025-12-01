const CONFIG = require('../config');

// TTL付きキャッシュユーティリティ
class TTLCache {
    constructor(defaultTTL = 5 * 60 * 1000) { // デフォルト5分
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
        this.timers = new Map();
    }

    set(key, value, ttl = this.defaultTTL) {
        // 既存のタイマーをクリア
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // 値を設定
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttl
        });

        // タイマーを設定
        const timer = setTimeout(() => {
            this.delete(key);
        }, ttl);
        this.timers.set(key, timer);
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            return undefined;
        }

        // 期限切れチェック
        if (Date.now() > item.expiresAt) {
            this.delete(key);
            return undefined;
        }

        return item.value;
    }

    has(key) {
        const item = this.cache.get(key);
        if (!item) {
            return false;
        }

        if (Date.now() > item.expiresAt) {
            this.delete(key);
            return false;
        }

        return true;
    }

    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        this.cache.delete(key);
    }

    clear() {
        // すべてのタイマーをクリア
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.cache.clear();
    }

    // 期限切れのエントリをクリーンアップ
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.delete(key);
            }
        }
    }

    // サイズを取得
    size() {
        this.cleanup(); // クリーンアップしてからサイズを返す
        return this.cache.size;
    }
}

// グローバルインスタンス
const pendingWarnsCache = new TTLCache(CONFIG.PENDING_WARNS_CACHE_TTL);

// 定期的なクリーンアップ（1分ごと）
const CACHE_CLEANUP_INTERVAL = 60 * 1000; // 1分
setInterval(() => {
    pendingWarnsCache.cleanup();
}, CACHE_CLEANUP_INTERVAL);

module.exports = {
    TTLCache,
    pendingWarnsCache
};

