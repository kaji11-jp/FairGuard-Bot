const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// スラッシュコマンド定義
const commands = [
    // ユーザー用コマンド
    new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('異議申し立てを提出します')
        .addStringOption(option =>
            option.setName('log_id')
                .setDescription('警告ログID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('異議申し立ての理由')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('チケット管理')
        .addSubcommand(subcommand =>
            subcommand
                .setName('open')
                .setDescription('新しいチケットを作成'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('close')
                .setDescription('チケットを閉鎖（管理者専用）')),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('コマンド一覧を表示'),
    
    // 管理者用コマンド
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('ユーザーに警告を発行します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('警告を発行するユーザー')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('警告の理由')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('対象メッセージID（オプション）')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('unwarn')
        .setDescription('ユーザーの警告を削減します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('ユーザーID')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('削減する警告数（デフォルト: 1）')
                .setRequired(false)
                .setMinValue(1)),
    
    new SlashCommandBuilder()
        .setName('addword')
        .setDescription('禁止ワードを追加します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('word')
                .setDescription('追加する単語')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('ワードタイプ')
                .setRequired(false)
                .addChoices(
                    { name: 'Blacklist (即死)', value: 'black' },
                    { name: 'Graylist (AI審議)', value: 'gray' }
                )),
    
    new SlashCommandBuilder()
        .setName('removeword')
        .setDescription('禁止ワードを削除します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('word')
                .setDescription('削除する単語')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('listword')
        .setDescription('禁止ワード一覧を表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('ユーザーをタイムアウトします（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('ユーザーID')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('cmdlog')
        .setDescription('コマンド履歴を表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('表示件数（デフォルト: 10、最大: 50）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(50)),
    
    new SlashCommandBuilder()
        .setName('warnlog')
        .setDescription('警告履歴を表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('ユーザーID（オプション）')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('表示件数（デフォルト: 10、最大: 50）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(50)),
    
    // フルモード専用コマンド
    new SlashCommandBuilder()
        .setName('tone')
        .setDescription('文章をやわらかく言い換えます（フルモード専用）')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('リライトする文章')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('analytics')
        .setDescription('警告相関分析レポートを表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('分析期間（日数、デフォルト: 30）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(365)),
    
    new SlashCommandBuilder()
        .setName('trustscore')
        .setDescription('ユーザーの信用スコアを表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認するユーザー')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('wordcandidates')
        .setDescription('危険ワード候補を表示します（管理者専用、フルモード専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
].map(command => command.toJSON());

module.exports = { commands };

