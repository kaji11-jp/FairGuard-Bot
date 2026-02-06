const { REST, Routes } = require('discord.js');
require('dotenv').config();
const { commands } = require('../commands/commands');

const rest = new REST().setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log(`🔄 ${commands.length}個のスラッシュコマンドを登録中...`);

        // クライアントIDを取得（環境変数またはDiscord APIから）
        let clientId = process.env.BOT_CLIENT_ID;
        if (!clientId) {
            // フォールバック: REST APIから取得
            const app = await rest.get(Routes.oauth2Application());
            clientId = app.id;
        }

        if (!clientId) {
            throw new Error('クライアントIDを取得できませんでした。.envにBOT_CLIENT_IDを設定するか、Discord API経由での取得を確認してください。');
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

