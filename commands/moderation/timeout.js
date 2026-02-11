const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../../config');
const { saveModLog } = require('../../utils/logs');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('ユーザーをタイムアウトします（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('ユーザーID')
                .setRequired(true)),

    async execute(interaction) {
        const userId = interaction.options.getString('user_id');

        const mem = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!mem) {
            return interaction.reply({ content: '❌ ユーザーが見つかりません', ephemeral: true });
        }

        // 管理者に対する操作禁止
        if (isAdminUser(mem)) {
            return interaction.reply({ content: '❌ 管理者をタイムアウトすることはできません', ephemeral: true });
        }

        try {
            await mem.timeout(CONFIG.TIMEOUT_DURATION, `手動タイムアウト by ${interaction.user.tag}`);

            const logId = Date.now().toString(36);
            saveModLog({
                id: logId,
                type: 'TIMEOUT',
                userId: userId,
                moderatorId: interaction.user.id,
                timestamp: Date.now(),
                reason: '手動タイムアウト',
                content: '',
                contextData: '',
                aiAnalysis: null
            });

            return interaction.reply({ content: `🔨 ${mem.user} をタイムアウトしました (${CONFIG.TIMEOUT_DURATION / 1000 / 60}分)`, ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: `❌ タイムアウトの実行に失敗しました: ${e.message}`, ephemeral: true });
        }
    },
};
