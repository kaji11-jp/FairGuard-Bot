const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdlog')
        .setDescription('コマンド履歴を表示します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('表示件数（デフォルト: 10、最大: 50）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(50)),

    async execute(interaction) {
        const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);
        const logs = db.prepare('SELECT * FROM command_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?').all(interaction.guild.id, limit);

        if (logs.length === 0) {
            return interaction.reply({ content: '📝 コマンド履歴がありません', ephemeral: true });
        }

        // 警告頻度の集計ロジック
        const warnLogs = logs.filter(log => log.command === 'warn' && log.success === 1);
        const warnFrequency = {};
        warnLogs.forEach(log => {
            const args = JSON.parse(log.args || '[]');
            const targetId = args[0]?.replace(/[<@!>]/g, '') || 'unknown';
            if (!warnFrequency[targetId]) {
                warnFrequency[targetId] = { count: 0, times: [] };
            }
            warnFrequency[targetId].count++;
            warnFrequency[targetId].times.push(log.timestamp);
        });

        const logText = logs.map(log => {
            const user = interaction.guild.members.cache.get(log.user_id);
            const date = new Date(log.timestamp).toLocaleString('ja-JP', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const args = JSON.parse(log.args || '[]');
            const argsText = args.length > 0 ? args.join(' ') : '';
            const commandText = argsText ? `/${log.command} ${argsText}` : `/${log.command}`;
            return `\`${date}\` **${user?.user?.tag || log.user_id}**: \`${commandText}\` ${log.success ? '✅' : '❌'}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📝 コマンド履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: `最新${logs.length}件表示` });

        const frequentWarns = Object.entries(warnFrequency).filter(([_, data]) => data.count >= 2);
        if (frequentWarns.length > 0) {
            const warnText = frequentWarns.map(([targetId, data]) => {
                const target = interaction.guild.members.cache.get(targetId);
                const timeDiff = Math.max(...data.times) - Math.min(...data.times);
                const minutes = Math.floor(timeDiff / 60000);
                return `**${target?.user?.tag || targetId}**: ${data.count}回 (${minutes}分以内)`;
            }).join('\n');

            embed.addFields({
                name: '⚠️ 警告頻度が高いユーザー',
                value: warnText.length > 1024 ? warnText.substring(0, 1024) + '...' : warnText || 'なし',
                inline: false
            });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
