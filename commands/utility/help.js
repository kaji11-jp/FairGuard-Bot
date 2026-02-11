const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const CONFIG = require('../../config');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('コマンド一覧を表示します'),

    async execute(interaction) {
        const isAdmin = isAdminUser(interaction.member);

        // コマンド一覧を作成
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📜 コマンド一覧')
            .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

        // カテゴリごとにコマンドを分類（ディレクトリ構成に基づく単純な分類、または手動定義）
        // ここでは主要なコマンドを手動で整理して表示するスタイルを採用（または動的取得も可能だが、見やすさ重視）

        const userCommands = [
            '`/appeal`: 異議申し立てを提出',
            '`/ticket open`: お問い合わせチケットを作成',
            '`/help`: このヘルプを表示'
        ];

        embed.addFields({ name: '👤 ユーザー用', value: userCommands.join('\n') });

        if (isAdmin) {
            const adminCommands = [
                '`/warn <user> [reason]`: ユーザーに警告を発行',
                '`/unwarn <user_id> [amount]`: 警告を取り消し',
                '`/timeout <user_id>`: ユーザーをタイムアウト',
                '`/addword <word> [type]`: 禁止ワードを追加',
                '`/removeword <word>`: 禁止ワードを削除',
                '`/listword`: 禁止ワード一覧を表示',
                '`/cmdlog [limit]`: コマンド実行履歴を表示',
                '`/warnlog <user_id> [limit]`: 警告履歴を表示',
                '`/ticket close`: チケットを閉鎖（チケット内のみ）',
                '`/rule`: サーバー独自ルールの管理',
                '`/aimodel`: AIモデルの切り替え'
            ];

            if (CONFIG.AI_MODE === 'full') {
                adminCommands.push(
                    '`/tone <text>`: 文章のリライト（AI）',
                    '`/analytics [days]`: 警告統計レポート',
                    '`/trustscore <user>`: 信用スコア確認',
                    '`/wordcandidates`: 危険ワード候補確認'
                );
            }

            embed.addFields({ name: '👮 管理者用', value: adminCommands.join('\n') });
            embed.setColor('#ff9900');
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
