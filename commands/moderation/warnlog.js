const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
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

    async execute(interaction) {
        const targetId = interaction.options.getString('user_id');
        const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);

        let logs;
        if (targetId) {
            logs = db.prepare('SELECT * FROM mod_logs WHERE user_id = ? AND type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all(targetId, 'WARN%', limit);
        } else {
            logs = db.prepare('SELECT * FROM mod_logs WHERE type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all('WARN%', limit);
        }

        if (logs.length === 0) {
            return interaction.reply({ content: '📝 警告履歴がありません', ephemeral: true });
        }

        const logText = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('ja-JP', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            const moderator = interaction.guild.members.cache.get(log.moderator_id);
            const target = interaction.guild.members.cache.get(log.user_id);
            return `\`${date}\` ${target?.user?.tag || log.user_id} ← ${moderator?.user?.tag || log.moderator_id}\n理由: ${log.reason}\nID: \`${log.id}\``;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('⚠️ 警告履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: targetId ? `対象: ${targetId}` : `最新${logs.length}件` });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
