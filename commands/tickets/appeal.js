const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const CONFIG = require('../../config');
const { callGemini } = require('../../services/ai');
const { reduceWarning } = require('../../services/warnings');
const db = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('異議申し立てを提出します')
        .addStringOption(option =>
            option.setName('log_id')
                .setDescription('警告ログID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('異議申し立ての理由')
                .setRequired(true)),

    async execute(interaction) {
        const logId = interaction.options.getString('log_id');
        const reason = interaction.options.getString('reason');

        const log = db.prepare('SELECT * FROM mod_logs WHERE id = ?').get(logId);
        if (!log || log.user_id !== interaction.user.id) {
            return interaction.reply({ content: '❌ データなし', ephemeral: true });
        }
        if (log.is_resolved) {
            return interaction.reply({ content: '✅ 既に解決済みです', ephemeral: true });
        }

        const APPEAL_DEADLINE_MS = CONFIG.APPEAL_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
        const timeSincePunishment = Date.now() - log.timestamp;
        if (timeSincePunishment > APPEAL_DEADLINE_MS) {
            const daysPassed = Math.floor(timeSincePunishment / (24 * 60 * 60 * 1000));
            return interaction.reply({ content: `❌ 異議申し立ての期限（${CONFIG.APPEAL_DEADLINE_DAYS}日以内）を過ぎています。処罰から${daysPassed}日経過しています。`, ephemeral: true });
        }

        await interaction.deferReply();

        const prompt = `
あなたは公平な裁判官AIです。ユーザーの異議を審査してください。

【ルール】
1. **「言及」の保護**: 禁止ワードについて議論・引用している場合は、言葉自体が悪くても【ACCEPTED】です。
2. **過去は不問**: 過去の態度が悪くても、今回の発言と異議理由が正当なら【ACCEPTED】です。
3. **嘘の排除**: 文脈と明らかに矛盾する嘘の言い訳は【REJECTED】です。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"status": "ACCEPTED" or "REJECTED", "reason": "日本語で公平な理由を記述"}

[警告理由]: ${log.reason}
[ユーザー異議]: ${reason}
[元発言]: ${log.content}
[文脈]: ${log.context_data}
        `;

        const result = await callGemini(prompt);
        if (!result) {
            return interaction.editReply({ content: '❌ AIエラー' });
        }

        const isAccepted = result.status === 'ACCEPTED';
        if (isAccepted) {
            reduceWarning(interaction.user.id, 1);
            db.prepare('UPDATE mod_logs SET is_resolved = 1 WHERE id = ?').run(logId);
        }

        const embed = new EmbedBuilder()
            .setColor(isAccepted ? '#00ff00' : '#ff0000')
            .setTitle(`⚖️ 審判結果: ${result.status}`)
            .setDescription(result.reason)
            .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });

        return interaction.editReply({ embeds: [embed] });
    },
};
