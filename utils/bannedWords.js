const db = require('../database');

// キャッシュ管理
let blacklistCache = new Set();
let graylistCache = new Set();
const DEFAULT_GRAY_WORDS = ["死ね", "殺す", "ゴミ", "カス", "うざい", "きもい", "ガイジ", "馬鹿", "アホ", "kill", "noob"];

const loadBannedWords = () => {
    blacklistCache.clear();
    graylistCache.clear();
    const rows = db.prepare('SELECT word, type FROM banned_words').all();

    const insert = db.prepare('INSERT OR IGNORE INTO banned_words (word, type) VALUES (?, ?)');
    if (rows.length === 0) {
        DEFAULT_GRAY_WORDS.forEach(w => insert.run(w.toLowerCase(), 'GRAY'));
    }

    // 常にDBから最新をロード（初期投入後も含めて）
    const allRows = db.prepare('SELECT word, type FROM banned_words').all();
    allRows.forEach(row => {
        const word = row.word.toLowerCase();
        if (row.type === 'GRAY') graylistCache.add(word);
        else blacklistCache.add(word);
    });
};

// 初期ロード
loadBannedWords();

module.exports = {
    blacklistCache,
    graylistCache,
    loadBannedWords
};

