const db = require('../database');

// キャッシュ管理
let blacklistCache = new Set();
let graylistCache = new Set();
const DEFAULT_GRAY_WORDS = ["死ね", "殺す", "ゴミ", "カス", "うざい", "きもい", "ガイジ", "馬鹿", "アホ", "kill", "noob"];

const loadBannedWords = () => {
    blacklistCache.clear();
    graylistCache.clear();
    const rows = db.prepare('SELECT word, type FROM banned_words').all();
    
    if (rows.length === 0) {
        const insert = db.prepare('INSERT OR IGNORE INTO banned_words (word, type) VALUES (?, ?)');
        DEFAULT_GRAY_WORDS.forEach(w => insert.run(w, 'GRAY'));
        DEFAULT_GRAY_WORDS.forEach(w => graylistCache.add(w));
    } else {
        rows.forEach(row => {
            if (row.type === 'GRAY') graylistCache.add(row.word);
            else blacklistCache.add(row.word);
        });
    }
};

// 初期ロード
loadBannedWords();

module.exports = {
    blacklistCache,
    graylistCache,
    loadBannedWords
};

