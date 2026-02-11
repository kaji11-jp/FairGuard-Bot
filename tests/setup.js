// テスト実行前に環境変数をモック設定する
// 64文字のHEX文字列（Encryption Keyのバリデーションを通過するため）
process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

// その他の必須環境変数
process.env.BOT_TOKEN = 'mock_bot_token';
process.env.GEMINI_API_KEY = 'mock_gemini_api_key';
process.env.DISCORD_GUILD_ID = 'mock_guild_id';
process.env.DISCORD_ADMIN_ROLE_ID = 'mock_role_id';
process.env.DISCORD_ALERT_CHANNEL_ID = 'mock_channel_id';
process.env.DISCORD_TICKET_CATEGORY_ID = 'mock_category_id';
process.env.AI_PROVIDER = 'gemini'; // デフォルトプロバイダー

// コンソールログの抑制（必要に応じて）
// global.console = {
//   ...console,
//   log: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };
