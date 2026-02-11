const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, '../commands');

// コマンドフォルダの再帰的読み込み関数
function loadCommands(dir) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            loadCommands(filePath);
        } else if (file.endsWith('.js')) {
            // commands.js (古い定義ファイル) は除外
            if (file === 'commands.js') continue;

            try {
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    commands.push(command.data.toJSON());
                } else {
                    console.warn(`[警告] コマンド ${filePath} には必要な "data" または "execute" プロパティがありません。`);
                }
            } catch (error) {
                console.error(`[エラー] コマンドロード失敗: ${filePath}`, error);
            }
        }
    }
}

// コマンド読み込み開始
loadCommands(commandsPath);

const rest = new REST().setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log(`🔄 ${commands.length}個のスラッシュコマンドを登録中...`);

        // クライアントIDを取得（環境変数またはDiscord APIから）
        let clientId = process.env.BOT_CLIENT_ID;
        if (!clientId) {
            // フォールバック: REST APIから取得
            try {
                const app = await rest.get(Routes.oauth2CurrentApplication());
                clientId = app.id;
            } catch (e) {
                console.error('クライアントIDの取得に失敗しました。BOT_TOKENが正しいか確認してください。');
                process.exit(1);
            }
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
