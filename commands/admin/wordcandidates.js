const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../../config');
const { getWordCandidates } = require('../../services/wordLearning');
const { isAdminUser } = require('../../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordcandidates')
        .setDescription('危険ワード候補を表示します（管理者専用、フルモード専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!isAdminUser(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者専用です', ephemeral: true });
        }

        if (CONFIG.AI_MODE !== 'full') {
            return interaction.reply({ content: '❌ このコマンドはフルモード（AI_MODE=full）でのみ利用可能です', ephemeral: true });
        }

        try {
            const candidates = getWordCandidates(10);

            if (candidates.length === 0) {
                return interaction.reply({ content: '📝 危険ワード候補はありません', ephemeral: true });
            }

            const candidatesText = candidates.map(c =>
                `\`${c.word}\`: 危険度${c.danger_score}/100, 出現${c.frequency}回, 推奨: ${c.suggested_type || '未定'}`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🔍 危険ワード候補')
                .setDescription(candidatesText)
                .setFooter({ text: 'AIが自動検出した危険ワード候補です。必要に応じて手動で追加してください。' });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: `❌ データ取得中にエラーが発生しました: ${e.message}`, ephemeral: true });
        }
    },
};
