const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { saveModLog } = require('../../utils/logs');
const { loadBannedWords } = require('../../utils/bannedWords');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removeword')
        .setDescription('禁止ワードを削除します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('word')
                .setDescription('削除する単語')
                .setRequired(true)),

    async execute(interaction) {
        const word = interaction.options.getString('word');

        const result = db.prepare('DELETE FROM banned_words WHERE word = ?').run(word.toLowerCase());
        if (result.changes === 0) {
            return interaction.reply({ content: `❌ 単語「${word}」が見つかりませんでした`, ephemeral: true });
        }

        loadBannedWords();

        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'REMOVEWORD',
            userId: interaction.user.id,
            moderatorId: interaction.user.id,
            timestamp: Date.now(),
            reason: `単語削除: ${word}`,
            content: word,
            contextData: '',
            aiAnalysis: null
        });

        return interaction.reply({ content: `✅ 削除: ${word}`, ephemeral: true });
    },
};
