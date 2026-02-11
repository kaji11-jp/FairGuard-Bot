const CONFIG = require('../config');

// 管理者チェック（ロールIDまたはユーザーID）
function isAdminUser(member) {
    if (!member) return false;
    const validAdminIds = CONFIG.ADMIN_USER_IDS.filter(id => id && id.trim() !== '');
    if (validAdminIds.includes(member.id)) return true;
    if (CONFIG.ADMIN_ROLE_ID && member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) return true;
    return false;
}

module.exports = { isAdminUser };

