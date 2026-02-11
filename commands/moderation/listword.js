const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { blacklistCache, graylistCache } = require('../../utils/bannedWords');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listword')
        .setDescription('禁止ワード一覧を表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const blackList = Array.from(blacklistCache).join(', ') || 'なし';
        const grayList = Array.from(graylistCache).join(', ') || 'なし';

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📜 禁止ワード一覧')
            .addFields(
                { name: '🚫 即死 (Blacklist)', value: blackList },
                { name: '⚡ AI審議 (Graylist)', value: grayList }
            );

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
