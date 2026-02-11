const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { saveModLog } = require('../../utils/logs');
const { loadBannedWords } = require('../../utils/bannedWords');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addword')
        .setDescription('禁止ワードを追加します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('word')
                .setDescription('追加する単語')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('ワードタイプ')
                .setRequired(false)
                .addChoices(
                    { name: 'Blacklist (即死)', value: 'black' },
                    { name: 'Graylist (AI審議)', value: 'gray' }
                )),

    async execute(interaction) {
        const word = interaction.options.getString('word');
        const typeArg = interaction.options.getString('type') || 'black';

        if (word.length > 100) {
            return interaction.reply({ content: '❌ 単語が長すぎます（最大100文字）', ephemeral: true });
        }

        const type = (typeArg === 'gray' || typeArg === 'g') ? 'GRAY' : 'BLACK';

        db.prepare('INSERT OR REPLACE INTO banned_words (word, type) VALUES (?, ?)').run(word.toLowerCase(), type);
        loadBannedWords();

        const logId = Date.now().toString(36);
        saveModLog({
            id: logId,
            type: 'ADDWORD',
            userId: interaction.user.id,
            moderatorId: interaction.user.id,
            timestamp: Date.now(),
            reason: `単語追加: ${word} (${type})`,
            content: word,
            contextData: '',
            aiAnalysis: null
        });

        return interaction.reply({ content: `✅ 追加: **${word}** (${type})`, ephemeral: true });
    },
};
