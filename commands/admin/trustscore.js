const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { updateTrustScore } = require('../../services/trustScore');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trustscore')
        .setDescription('ユーザーの信用スコアを表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認するユーザー')
                .setRequired(false)),

    async execute(interaction) {
        if (!isAdminUser(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者専用です', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;

        await interaction.deferReply();
        try {
            const score = updateTrustScore(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(score >= 70 ? '#00ff00' : score >= 40 ? '#ffaa00' : '#ff0000')
                .setTitle('📊 信用スコア')
                .setDescription(`**${targetUser.tag}** の信用スコア`)
                .addFields(
                    { name: 'スコア', value: `${score}/100`, inline: true },
                    { name: '評価', value: score >= 70 ? '🟢 良好' : score >= 40 ? '🟡 注意' : '🔴 要監視', inline: true }
                )
                .setFooter({ text: 'スコアは警告数、スパム傾向、参加日数などから計算されます' });

            return interaction.editReply({ embeds: [embed] });
        } catch (e) {
            return interaction.editReply({ content: `❌ スコア計算中にエラーが発生しました: ${e.message}` });
        }
    },
};
