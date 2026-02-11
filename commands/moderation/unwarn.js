const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { reduceWarning } = require('../../services/warnings');
const { saveModLog } = require('../../utils/logs');

module.exports = {
    data: new SlashCommandBuilder()
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

    async execute(interaction) {
        const userId = interaction.options.getString('user_id');
        const amount = interaction.options.getInteger('amount') || 1;

        // ユーザー存在確認
        const target = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!target) {
            return interaction.reply({ content: '❌ ユーザーが見つかりません。IDが正しいか確認してください。', ephemeral: true });
        }

        const newCount = reduceWarning(userId, amount);

        // ログ保存
        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'UNWARN',
            userId: userId,
            moderatorId: interaction.user.id,
            timestamp: Date.now(),
            reason: `${amount}個の警告を削減`,
            content: '',
            contextData: '',
            aiAnalysis: null
        });

        return interaction.reply({ content: `✅ ${target.user} の警告を${amount}個削減しました (現在: ${newCount})`, ephemeral: true });
    },
};
