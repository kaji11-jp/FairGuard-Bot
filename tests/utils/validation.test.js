const { validateLogId, validateReason, validateWord, validateUserId, validateNumber } = require('../../utils/validation');

describe('Input Validation', () => {
    describe('validateLogId', () => {
        test('有効なログIDを受け入れる', () => {
            const result = validateLogId('abc123');
            expect(result.valid).toBe(true);
        });
        
        test('長すぎるログIDを拒否する', () => {
            const result = validateLogId('a'.repeat(37));
            expect(result.valid).toBe(false);
            expect(result.error).toContain('長すぎます');
        });
        
        test('無効な文字を含むログIDを拒否する', () => {
            const result = validateLogId('abc@123');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('無効な文字');
        });
        
        test('空のログIDを拒否する', () => {
            const result = validateLogId('');
            expect(result.valid).toBe(false);
        });
    });
    
    describe('validateReason', () => {
        test('有効な理由を受け入れる', () => {
            const result = validateReason('適切な理由');
            expect(result.valid).toBe(true);
            expect(result.value).toBe('適切な理由');
        });
        
        test('長すぎる理由を拒否する', () => {
            const result = validateReason('a'.repeat(501));
            expect(result.valid).toBe(false);
            expect(result.error).toContain('長すぎます');
        });
        
        test('空の理由を拒否する', () => {
            const result = validateReason('');
            expect(result.valid).toBe(false);
        });
        
        test('改行が多すぎる理由を拒否する', () => {
            const result = validateReason('a\n'.repeat(11));
            expect(result.valid).toBe(false);
            expect(result.error).toContain('改行');
        });
    });
    
    describe('validateWord', () => {
        test('有効な単語を受け入れる', () => {
            const result = validateWord('テスト');
            expect(result.valid).toBe(true);
            expect(result.value).toBe('テスト');
        });
        
        test('長すぎる単語を拒否する', () => {
            const result = validateWord('a'.repeat(101));
            expect(result.valid).toBe(false);
        });
        
        test('無効な文字を含む単語を拒否する', () => {
            const result = validateWord('test@word');
            expect(result.valid).toBe(false);
        });
    });
    
    describe('validateUserId', () => {
        test('有効なDiscord IDを受け入れる', () => {
            const result = validateUserId('123456789012345678');
            expect(result.valid).toBe(true);
        });
        
        test('短すぎるIDを拒否する', () => {
            const result = validateUserId('1234567890123456');
            expect(result.valid).toBe(false);
        });
        
        test('数字以外を含むIDを拒否する', () => {
            const result = validateUserId('12345678901234567a');
            expect(result.valid).toBe(false);
        });
    });
    
    describe('validateNumber', () => {
        test('有効な数値を受け入れる', () => {
            const result = validateNumber('10', 1, 100, '件数');
            expect(result.valid).toBe(true);
            expect(result.value).toBe(10);
        });
        
        test('最小値未満の数値を拒否する', () => {
            const result = validateNumber('0', 1, 100, '件数');
            expect(result.valid).toBe(false);
        });
        
        test('最大値を超える数値を拒否する', () => {
            const result = validateNumber('101', 1, 100, '件数');
            expect(result.valid).toBe(false);
        });
        
        test('数値でない値を拒否する', () => {
            const result = validateNumber('abc', 1, 100, '件数');
            expect(result.valid).toBe(false);
        });
    });
});

