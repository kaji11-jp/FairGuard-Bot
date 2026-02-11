const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const configManager = require('../../services/configManager');

const ALL_MODELS = [
    // --- Google Gemini ---
    {
        label: 'Gemini 3 Pro (最高性能)',
        value: 'gemini:gemini-3-pro-preview',
        description: 'Googleの最先端・最高性能モデル（プレビュー）',
        emoji: '🌟'
    },
    {
        label: 'Gemini 3 Flash',
        value: 'gemini:gemini-3-flash-preview',
        description: '高速・高性能のバランス型次世代モデル（プレビュー）',
        emoji: '⚡'
    },
    {
        label: 'Gemini 2.5 Pro (安定板推奨)',
        value: 'gemini:gemini-2.5-pro',
        description: '安定稼働中の高性能モデル、本番利用向け',
        emoji: '💎'
    },
    {
        label: 'Gemini 2.5 Flash',
        value: 'gemini:gemini-2.5-flash',
        description: 'コスパ最強・高速モデル、本番利用向け',
        emoji: '🚀'
    },

    // --- OpenAI ---
    {
        label: 'GPT-5.2 (最高性能)',
        value: 'openai:gpt-5.2',
        description: 'OpenAIの最新フラッグシップ推論モデル',
        emoji: '🤖'
    },
    {
        label: 'GPT-5 Mini',
        value: 'openai:gpt-5-mini',
        description: '高速・低コストの推論モデル',
        emoji: '⚡'
    },
    {
        label: 'GPT-4.1',
        value: 'openai:gpt-4.1',
        description: 'コーディング・指示追従に強い安定モデル',
        emoji: '🧠'
    },

    // --- Anthropic (Claude) ---
    {
        label: 'Claude Opus 4.6 (最高性能)',
        value: 'claude:claude-opus-4-6',
        description: 'コーディング・エージェントに最強の最新モデル',
        emoji: '🎭'
    },
    {
        label: 'Claude Sonnet 4.5 (推奨)',
        value: 'claude:claude-sonnet-4-5-20250929',
        description: 'バランス・速度・コスト全て優秀なメインモデル',
        emoji: '⭐'
    },
    {
        label: 'Claude Haiku 4.5',
        value: 'claude:claude-haiku-4-5-20251001',
        description: '最速・軽量・低コストモデル',
        emoji: '🍃'
    },

    // --- Cerebras ---
    {
        label: 'GPT-OSS 120B (超高速)',
        value: 'cerebras:gpt-oss-120b',
        description: 'Cerebras上の最高性能モデル、3000 t/s超',
        emoji: '🏎️'
    },
    {
        label: 'Qwen 3 32B',
        value: 'cerebras:qwen-3-32b',
        description: '高知性・超高速推論 2600 t/s（2/16廃止予定）',
        emoji: '⚡'
    },
    {
        label: 'Llama 3.1 8B',
        value: 'cerebras:llama3.1-8b',
        description: '軽量・超高速・最安値 2200 t/s',
        emoji: '💨'
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aimodel')
        .setDescription('使用するAIモデルを変更します（管理者のみ）')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const currentProvider = configManager.get('AI_PROVIDER');
        const currentModelKey = `${currentProvider.toUpperCase()}_MODEL`;
        const currentModelName = configManager.get(currentModelKey);

        // 現在の設定値に近い選択肢をデフォルトにするための比較用値
        const currentValue = `${currentProvider}:${currentModelName}`;

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('aimodel_select')
            .setPlaceholder('使用するAIモデルを選択してください...')
            .addOptions(ALL_MODELS.map(opt => ({
                label: opt.label,
                value: opt.value,
                description: opt.description,
                emoji: opt.emoji,
                default: opt.value === currentValue
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('� AIモデル設定')
            .setDescription('ボットが使用するAIモデルを選択してください。\n変更は**即座に**反映されます。')
            .addFields(
                { name: '現在のプロバイダー', value: `**${currentProvider}**`, inline: true },
                { name: '現在のモデル', value: `\`${currentModelName}\``, inline: true }
            )
            .setFooter({ text: 'Google Cloud, OpenAI, Anthropic, Cerebras等の最新モデルに対応' });

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        // コレクターの設定
        const filter = i => i.customId === 'aimodel_select' && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            const selectedValue = i.values[0]; // "provider:model"
            const [newProvider, newModel] = selectedValue.split(':');

            // 1. プロバイダーを更新
            configManager.set('AI_PROVIDER', newProvider);

            // 2. そのプロバイダー用のモデル設定を更新
            const modelConfigKey = `${newProvider.toUpperCase()}_MODEL`;
            configManager.set(modelConfigKey, newModel);

            const resultEmbed = new EmbedBuilder()
                .setColor('#2ecc71') // Green
                .setTitle('✅ 設定を更新しました')
                .setDescription(`AIモデルを切り替えました。`)
                .addFields(
                    { name: '新プロバイダー', value: `**${newProvider}**`, inline: true },
                    { name: '新モデル', value: `\`${newModel}\``, inline: true }
                )
                .setTimestamp();

            await i.update({ embeds: [resultEmbed], components: [] });
            collector.stop();
        });

        collector.on('end', collected => {
            // タイムアウト時は特に何もしない（メッセージは残る）
        });
    }
};
