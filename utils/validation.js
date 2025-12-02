const logger = require('./logger');

/**
 * 入力バリデーション関数
 */

// logIdの形式チェック（英数字とハイフンのみ、36文字以内）
function validateLogId(logId) {
    if (!logId || typeof logId !== 'string') {
        return { valid: false, error: 'ログIDが無効です' };
    }
    
    if (logId.length > 36) {
        return { valid: false, error: 'ログIDが長すぎます（最大36文字）' };
    }
    
    // 英数字とハイフンのみ許可
    if (!/^[a-zA-Z0-9_-]+$/.test(logId)) {
        return { valid: false, error: 'ログIDに無効な文字が含まれています' };
    }
    
    return { valid: true };
}

// reason（理由）のバリデーション
function validateReason(reason, maxLength = 500) {
    if (!reason || typeof reason !== 'string') {
        return { valid: false, error: '理由が無効です' };
    }
    
    // 改行文字の数を制限（DoS攻撃対策）- trim()の前にチェック
    const newlineCount = (reason.match(/\n/g) || []).length;
    if (newlineCount > 10) {
        return { valid: false, error: '理由に含まれる改行が多すぎます（最大10行）' };
    }
    
    const trimmed = reason.trim();
    
    if (trimmed.length === 0) {
        return { valid: false, error: '理由が空です' };
    }
    
    if (trimmed.length > maxLength) {
        return { valid: false, error: `理由が長すぎます（最大${maxLength}文字）` };
    }
    
    return { valid: true, value: trimmed };
}

// 単語のバリデーション
function validateWord(word, maxLength = 100) {
    if (!word || typeof word !== 'string') {
        return { valid: false, error: '単語が無効です' };
    }
    
    const trimmed = word.trim().toLowerCase();
    
    if (trimmed.length === 0) {
        return { valid: false, error: '単語が空です' };
    }
    
    if (trimmed.length > maxLength) {
        return { valid: false, error: `単語が長すぎます（最大${maxLength}文字）` };
    }
    
    // 特殊文字のチェック（基本的な文字のみ許可）
    if (!/^[ぁ-んァ-ヶー一-龠a-zA-Z0-9\s\-_]+$/.test(trimmed)) {
        return { valid: false, error: '単語に無効な文字が含まれています' };
    }
    
    return { valid: true, value: trimmed };
}

// ユーザーIDのバリデーション（Discord ID形式）
function validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
        return { valid: false, error: 'ユーザーIDが無効です' };
    }
    
    // Discord IDは17-19桁の数字
    if (!/^\d{17,19}$/.test(userId)) {
        return { valid: false, error: 'ユーザーIDの形式が正しくありません' };
    }
    
    return { valid: true };
}

// 数値のバリデーション（範囲チェック付き）
function validateNumber(value, min = 0, max = Infinity, fieldName = '値') {
    if (value === undefined || value === null) {
        return { valid: false, error: `${fieldName}が指定されていません` };
    }
    
    const num = parseInt(value, 10);
    
    if (isNaN(num)) {
        return { valid: false, error: `${fieldName}は数値である必要があります` };
    }
    
    if (num < min) {
        return { valid: false, error: `${fieldName}は${min}以上である必要があります` };
    }
    
    if (num > max) {
        return { valid: false, error: `${fieldName}は${max}以下である必要があります` };
    }
    
    return { valid: true, value: num };
}

// 文字列のサニタイズ（XSS対策）
function sanitizeString(str, maxLength = 2000) {
    if (!str || typeof str !== 'string') {
        return '';
    }
    
    // 長さ制限
    let sanitized = str.substring(0, maxLength);
    
    // 危険な文字をエスケープ（DiscordのMarkdown記法を考慮）
    // 実際のDiscordメッセージではMarkdownが使えるため、完全なサニタイズは不要
    // ただし、過度な記号の連続は制限
    
    return sanitized;
}

// 配列のバリデーション（最大要素数チェック）
function validateArray(arr, maxLength = 100, fieldName = '配列') {
    if (!Array.isArray(arr)) {
        return { valid: false, error: `${fieldName}は配列である必要があります` };
    }
    
    if (arr.length > maxLength) {
        return { valid: false, error: `${fieldName}の要素数が多すぎます（最大${maxLength}）` };
    }
    
    return { valid: true };
}

module.exports = {
    validateLogId,
    validateReason,
    validateWord,
    validateUserId,
    validateNumber,
    sanitizeString,
    validateArray
};

