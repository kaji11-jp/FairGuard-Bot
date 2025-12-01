const { checkRateLimit } = require('../../utils/rateLimit');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// テスト用データベース
let testDb;
const testDbPath = path.join(__dirname, '../../test_bot_data.sqlite');

describe('Rate Limit', () => {
    beforeEach(() => {
        // 既存のテストDBを削除
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        // テスト用データベースを作成
        testDb = new Database(testDbPath);
        
        // テーブル作成
        testDb.exec(`
            CREATE TABLE IF NOT EXISTS command_rate_limits (
                user_id TEXT PRIMARY KEY, 
                last_command_time INTEGER, 
                command_count INTEGER DEFAULT 0
            );
        `);
        
        // モジュールのデータベース参照を一時的にテストDBに置き換え
        const dbModule = require('../../database');
        dbModule.prepare = testDb.prepare.bind(testDb);
        dbModule.transaction = testDb.transaction.bind(testDb);
    });
    
    afterEach(() => {
        if (testDb) {
            testDb.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });
    
    test('新しいユーザーはレート制限を通過できる', () => {
        const userId = '123456789';
        const result = checkRateLimit(userId);
        expect(result).toBe(true);
        
        const row = testDb.prepare('SELECT * FROM command_rate_limits WHERE user_id = ?').get(userId);
        expect(row).toBeDefined();
        expect(row.command_count).toBe(1);
    });
    
    test('レート制限内のユーザーは通過できる', () => {
        const userId = '123456789';
        const now = Date.now();
        
        // 初回実行
        testDb.prepare('INSERT INTO command_rate_limits (user_id, last_command_time, command_count) VALUES (?, ?, ?)')
            .run(userId, now, 2);
        
        const result = checkRateLimit(userId);
        expect(result).toBe(true);
        
        const row = testDb.prepare('SELECT * FROM command_rate_limits WHERE user_id = ?').get(userId);
        expect(row.command_count).toBe(3);
    });
    
    test('レート制限に達したユーザーはブロックされる', () => {
        const userId = '123456789';
        const now = Date.now();
        
        // レート制限に達した状態を作成
        testDb.prepare('INSERT INTO command_rate_limits (user_id, last_command_time, command_count) VALUES (?, ?, ?)')
            .run(userId, now, 5);
        
        const result = checkRateLimit(userId);
        expect(result).toBe(false);
    });
    
    test('時間窓を過ぎたユーザーはリセットされる', () => {
        const userId = '123456789';
        const oldTime = Date.now() - (2 * 60 * 1000); // 2分前
        
        // 古いレコードを作成
        testDb.prepare('INSERT INTO command_rate_limits (user_id, last_command_time, command_count) VALUES (?, ?, ?)')
            .run(userId, oldTime, 5);
        
        const result = checkRateLimit(userId);
        expect(result).toBe(true);
        
        const row = testDb.prepare('SELECT * FROM command_rate_limits WHERE user_id = ?').get(userId);
        expect(row.command_count).toBe(1); // リセットされている
    });
});

