const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { generateAnalyticsReport, createAnalyticsEmbed } = require('../../services/analytics');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('analytics')
        .setDescription('警告相関分析レポートを表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('分析期間（日数、デフォルト: 30）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(365)),

    async execute(interaction) {
        if (!isAdminUser(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者専用です', ephemeral: true });
        }

        const days = interaction.options.getInteger('days') || 30;
        await interaction.deferReply();

        try {
            const report = generateAnalyticsReport(interaction.guild.id, days);
            const embed = createAnalyticsEmbed(report, interaction.guild);
            return interaction.editReply({ embeds: [embed] });
        } catch (e) {
            return interaction.editReply({ content: `❌ レポート生成中にエラーが発生しました: ${e.message}` });
        }
    },
};
