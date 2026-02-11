const db = require('../database');

// キャッシュ管理
let blacklistCache = new Set();
let graylistCache = new Set();
const DEFAULT_GRAY_WORDS = [
    "死ね", "シネ", "しね",
    "殺す", "コロス", "ころす",
    "ゴミ", "ごみ",
    "カス", "かす",
    "うざい", "ウザい", "ウザイ",
    "きもい", "キモい", "キモイ",
    "ガイジ",
    "馬鹿", "バカ", "ばか",
    "アホ", "あほ",
    "kill", "noob"
];

const loadBannedWords = () => {
    blacklistCache.clear();
    graylistCache.clear();

    // デフォルトワードを常にDBに反映（存在しない場合のみ追加）
    const insert = db.prepare('INSERT OR IGNORE INTO banned_words (word, type) VALUES (?, ?)');
    DEFAULT_GRAY_WORDS.forEach(w => insert.run(w.toLowerCase(), 'GRAY'));

    // DBから最新の全単語をロード
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

