const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const CONFIG = require('../../config');
const { rewriteTextSoft } = require('../../services/textRewriter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tone')
        .setDescription('文章をやわらかく言い換えます（フルモード専用）')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('リライトする文章')
                .setRequired(true)),

    async execute(interaction) {
        if (CONFIG.AI_MODE !== 'full') {
            return interaction.reply({ content: '❌ このコマンドはフルモード（AI_MODE=full）でのみ利用可能です', ephemeral: true });
        }

        const text = interaction.options.getString('text');
        await interaction.deferReply();

        try {
            const result = await rewriteTextSoft(text);

            if (!result) {
                return interaction.editReply({ content: '❌ リライトに失敗しました' });
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('✨ 文章リライト結果')
                .addFields(
                    { name: '元の文章', value: text, inline: false },
                    { name: 'リライト後', value: result.rewritten, inline: false },
                    { name: '変更点', value: result.changes?.join('\n') || 'なし', inline: false },
                    { name: 'トーン改善', value: result.tone_improvement || 'なし', inline: false }
                )
                .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

            return interaction.editReply({ embeds: [embed] });
        } catch (e) {
            return interaction.editReply({ content: `❌ 処理中にエラーが発生しました: ${e.message}` });
        }
    },
};
