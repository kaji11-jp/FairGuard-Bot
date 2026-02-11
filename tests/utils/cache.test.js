const { TTLCache } = require('../../utils/cache');

describe('TTLCache', () => {
    let cache;
    
    beforeEach(() => {
        cache = new TTLCache(1000); // 1秒のTTL
    });
    
    afterEach(() => {
        cache.clear();
    });
    
    test('値を設定して取得できる', () => {
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
    });
    
    test('期限切れの値は取得できない', (done) => {
        cache.set('key1', 'value1', 100); // 100msのTTL
        
        setTimeout(() => {
            expect(cache.get('key1')).toBeUndefined();
            expect(cache.has('key1')).toBe(false);
            done();
        }, 150);
    });
    
    test('hasメソッドが正しく動作する', () => {
        cache.set('key1', 'value1');
        expect(cache.has('key1')).toBe(true);
        expect(cache.has('key2')).toBe(false);
    });
    
    test('deleteメソッドが正しく動作する', () => {
        cache.set('key1', 'value1');
        cache.delete('key1');
        expect(cache.has('key1')).toBe(false);
        expect(cache.get('key1')).toBeUndefined();
    });
    
    test('clearメソッドがすべての値を削除する', () => {
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.clear();
        expect(cache.size()).toBe(0);
    });
    
    test('cleanupメソッドが期限切れの値を削除する', (done) => {
        cache.set('key1', 'value1', 100);
        cache.set('key2', 'value2', 200);
        
        setTimeout(() => {
            cache.cleanup();
            expect(cache.has('key1')).toBe(false);
            expect(cache.has('key2')).toBe(true);
            done();
        }, 150);
    });
    
    test('sizeメソッドが正しいサイズを返す', () => {
        expect(cache.size()).toBe(0);
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        expect(cache.size()).toBe(2);
    });
});

