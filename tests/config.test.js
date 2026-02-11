describe('config module validation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('validateEnv returns missing keys when env vars not set', () => {
    // Ensure env keys are not set
    delete process.env.BOT_TOKEN;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_ADMIN_ROLE_ID;
    delete process.env.DISCORD_ALERT_CHANNEL_ID;
    delete process.env.DISCORD_TICKET_CATEGORY_ID;
    delete process.env.ENCRYPTION_KEY;

    const cfg = require('../config');
    const res = cfg.validateEnv();

    expect(res).toBeDefined();
    expect(Array.isArray(res.missing)).toBe(true);
    expect(res.missing.length).toBeGreaterThan(0);
    expect(res.missing).toEqual(expect.arrayContaining(['BOT_TOKEN', 'GEMINI_API_KEY']));
  });

  test('validateEnv returns no missing when env vars are set with valid formats', () => {
    jest.resetModules();

    process.env.BOT_TOKEN = 'TESTBOTTOKEN.aaaaaaaaaaaaaaaaaaaaaaaaaaa'; // valid format mock
    process.env.GEMINI_API_KEY = 'TESTGEMINIKEY.aaaaaaaaaaaaaaaaaaaaaaaaaaa'; // valid format mock
    process.env.ENCRYPTION_KEY = '0'.repeat(64); // valid format mock (64 chars hex)
    process.env.DISCORD_GUILD_ID = '12345678901234567';
    process.env.DISCORD_ADMIN_ROLE_ID = '12345678901234567';
    process.env.DISCORD_ALERT_CHANNEL_ID = '12345678901234567';
    process.env.DISCORD_TICKET_CATEGORY_ID = '12345678901234567';

    const cfg = require('../config');
    const res = cfg.validateEnv();

    expect(res).toBeDefined();
    expect(res.missing).toEqual([]);
    expect(res.invalid).toEqual([]);
  });
});
