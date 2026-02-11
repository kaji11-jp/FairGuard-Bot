const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addRule, removeRule, getRules } = require('../../services/rules');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rule')
        .setDescription('AI憲法（サーバー独自のルール）を管理します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('新しいルールを追加')
                .addStringOption(option =>
                    option.setName('content')
                        .setDescription('ルールの内容（例：「ネタバレ禁止」）')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('ルールを削除')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('削除するルールのID（/rule listで確認）')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('現在のルール一覧を表示')),

    async execute(interaction) {
        if (!isAdminUser(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者専用です', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const content = interaction.options.getString('content');
            try {
                addRule(content, interaction.user.tag);
                return interaction.reply({ content: `✅ ルールを追加しました: "${content}"`, ephemeral: true });
            } catch (e) {
                return interaction.reply({ content: `❌ エラーが発生しました: ${e.message}`, ephemeral: true });
            }
        }

        if (subcommand === 'remove') {
            const id = interaction.options.getInteger('id');
            try {
                const success = removeRule(id);
                if (success) {
                    return interaction.reply({ content: `✅ ルールID ${id} を削除しました`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `❌ ルールID ${id} が見つかりません`, ephemeral: true });
                }
            } catch (e) {
                return interaction.reply({ content: `❌ エラーが発生しました: ${e.message}`, ephemeral: true });
            }
        }

        if (subcommand === 'list') {
            const rules = getRules();
            if (rules.length === 0) {
                return interaction.reply({ content: '📝 登録されているルールはありません', ephemeral: true });
            }

            const ruleText = rules.map(r => `**ID ${r.id}**: ${r.content} (by ${r.added_by})`).join('\n');
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📜 AI憲法 (サーバー固有ルール)')
                .setDescription(ruleText)
                .setFooter({ text: 'これらのルールはAIの判断基準に組み込まれます' });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },
};
