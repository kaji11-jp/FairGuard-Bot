const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const logger = require('../utils/logger');

module.exports = (client) => {
    client.commands = new Map();
    const commandsPath = path.join(__dirname, '../commands');

    // コマンドフォルダが存在しない場合は作成
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
    }

    const commandFolders = fs.readdirSync(commandsPath).filter(file => fs.statSync(path.join(commandsPath, file)).isDirectory());
    const commands = [];

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            try {
                const command = require(filePath);

                // コマンドの必須プロパティチェック
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    commands.push(command.data.toJSON());
                    logger.info(`コマンドロード: ${command.data.name}`);
                } else {
                    logger.warn(`[警告] コマンド ${filePath} には必要な "data" または "execute" プロパティがありません。`);
                }
            } catch (error) {
                logger.error(`コマンドロードエラー: ${filePath}`, { error: error.message });
            }
        }
    }

    // コマンド登録用データをクライアントに保持（デプロイ用）
    client.commandData = commands;
};
