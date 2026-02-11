const { isAdminUser } = require('../../utils/permissions');
const CONFIG = require('../../config');

// Discord.jsのMemberオブジェクトをモック
function createMockMember(userId, roleIds = []) {
    return {
        id: userId,
        roles: {
            cache: {
                has: (roleId) => roleIds.includes(roleId)
            }
        }
    };
}

describe('Permissions', () => {
    const originalAdminUserIds = CONFIG.ADMIN_USER_IDS;
    const originalAdminRoleId = CONFIG.ADMIN_ROLE_ID;
    
    beforeEach(() => {
        // テスト用の設定を一時的に変更
        CONFIG.ADMIN_USER_IDS = ['admin1', 'admin2'];
        CONFIG.ADMIN_ROLE_ID = 'admin_role';
    });
    
    afterEach(() => {
        // 元の設定に戻す
        CONFIG.ADMIN_USER_IDS = originalAdminUserIds;
        CONFIG.ADMIN_ROLE_ID = originalAdminRoleId;
    });
    
    test('管理者ユーザーIDを持つメンバーは管理者として認識される', () => {
        const member = createMockMember('admin1');
        expect(isAdminUser(member)).toBe(true);
    });
    
    test('管理者ロールを持つメンバーは管理者として認識される', () => {
        const member = createMockMember('user1', ['admin_role']);
        expect(isAdminUser(member)).toBe(true);
    });
    
    test('管理者でないメンバーは管理者として認識されない', () => {
        const member = createMockMember('user1', ['normal_role']);
        expect(isAdminUser(member)).toBe(false);
    });
    
    test('nullメンバーは管理者として認識されない', () => {
        expect(isAdminUser(null)).toBe(false);
    });
    
    test('undefinedメンバーは管理者として認識されない', () => {
        expect(isAdminUser(undefined)).toBe(false);
    });
});

