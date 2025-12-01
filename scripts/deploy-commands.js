const { REST, Routes } = require('discord.js');
require('dotenv').config();
const { commands } = require('../commands/commands');

const rest = new REST().setToken(process.env.BOT_TOKEN);

// トークンからクライアントIDを取得
function getClientIdFromToken(token) {
    try {
        // Discord Bot Tokenの形式: BASE64_ENCODED_USER_ID.BASE64_ENCODED_TIMESTAMP.BASE64_ENCODED_HMAC
        // 最初の部分をデコードしてユーザーIDを取得
        const parts = token.split('.');
        if (parts.length >= 1) {
            const buffer = Buffer.from(parts[0], 'base64');
            return buffer.toString('utf-8');
        }
    } catch (e) {
        console.error('トークンからのクライアントID取得に失敗:', e);
    }
    return null;
}

(async () => {
    try {
        console.log(`🔄 ${commands.length}個のスラッシュコマンドを登録中...`);

        // クライアントIDを取得（環境変数またはトークンから）
        let clientId = process.env.BOT_CLIENT_ID;
        if (!clientId) {
            clientId = getClientIdFromToken(process.env.BOT_TOKEN);
            if (!clientId) {
                // フォールバック: REST APIから取得
                const app = await rest.get(Routes.oauth2Application());
                clientId = app.id;
            }
        }

        if (!clientId) {
            throw new Error('クライアントIDを取得できませんでした。.envにBOT_CLIENT_IDを設定してください。');
        }

        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, process.env.DISCORD_GUILD_ID),
            { body: commands }
        );

        console.log(`✅ ${data.length}個のスラッシュコマンドを登録しました！`);
    } catch (error) {
        console.error('❌ コマンド登録エラー:', error);
        process.exit(1);
    }
})();

