const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../../config');
const { fetchContext, checkWarnAbuse } = require('../../services/ai');
const { executeManualWarn } = require('../../handlers/commands'); // 共通ロジックとして再利用（後でUtility化推奨）
const { getActiveWarningCount } = require('../../services/warnings');
const { pendingWarnsCache } = require('../../utils/cache');
const db = require('../../database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('ユーザーに警告を発行します（管理者専用）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('警告を発行するユーザー')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('警告の理由')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('対象メッセージID（オプション）')
                .setRequired(false)),

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || '手動警告';
        const messageId = interaction.options.getString('message_id');

        await interaction.deferReply();

        let context = '';
        let content = '手動警告';
        let targetMessageId = null;

        if (messageId) {
            try {
                const replyMsg = await interaction.channel.messages.fetch(messageId);
                if (replyMsg.author.id !== target.id) {
                    return interaction.editReply({ content: '❌ 指定されたメッセージIDが対象ユーザーのものではありません' });
                }
                content = replyMsg.content;
                targetMessageId = replyMsg.id;
                context = await fetchContext(interaction.channel, replyMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return interaction.editReply({ content: '❌ メッセージの取得に失敗しました。IDが正しいか確認してください。' });
            }
        } else {
            // メッセージID指定なしの場合、直近のメッセージを探す
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                const targetMessages = messages.filter(m => m.author.id === target.id && !m.author.bot);

                if (targetMessages.size > 0) {
                    const latestMsg = targetMessages.first();
                    content = latestMsg.content;
                    targetMessageId = latestMsg.id;
                    context = await fetchContext(interaction.channel, latestMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
                } else {
                    // メッセージが見つからない場合でも警告は可能（手動入力理由のみ）
                    content = '（対象メッセージなし）';
                    context = '';
                }
            } catch (e) {
                logger.warn('メッセージ取得エラー', { error: e.message });
            }
        }

        // 頻度チェック（濫用防止）
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentWarns = db.prepare(`
            SELECT COUNT(*) as count, MAX(timestamp) as last_warn 
            FROM mod_logs 
            WHERE user_id = ? AND type = 'WARN_MANUAL' AND moderator_id = ? AND timestamp > ?
        `).get(target.id, interaction.user.id, oneHourAgo);

        // AIによる濫用チェック
        let abuseCheck;
        try {
            // contextがある程度ある場合のみチェック
            if (context && context.length > 50) {
                abuseCheck = await checkWarnAbuse(interaction.user.id, target.id, reason, context, content);
            }
        } catch (error) {
            logger.error('警告濫用チェックエラー', {
                moderatorId: interaction.user.id,
                targetId: target.id,
                error: error.message
            });
            // エラー時はチェックをスキップ
            abuseCheck = null;
        }

        if (abuseCheck && abuseCheck.is_abuse) {
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ 警告の濫用の可能性が検出されました')
                .setDescription(abuseCheck.reason)
                .addFields(
                    { name: '対象ユーザー', value: `${target}`, inline: true },
                    { name: '警告理由', value: reason, inline: true },
                    { name: '懸念点', value: abuseCheck.concerns?.join('\n') || 'なし', inline: false }
                );

            if (recentWarns.count >= 2) {
                const timeDiff = Date.now() - recentWarns.last_warn;
                const minutes = Math.floor(timeDiff / 60000);
                embed.addFields({
                    name: '⚠️ 警告頻度',
                    value: `過去1時間以内に同じユーザーへの警告が**${recentWarns.count}回**記録されています。\n最後の警告から${minutes}分経過しています。`,
                    inline: false
                });
            }

            embed.setFooter({ text: 'それでも警告を実行しますか？', iconURL: CONFIG.GEMINI_ICON });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`warn_confirm_${target.id}_${Date.now()}`)
                        .setLabel('✅ 実行する')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`warn_cancel_${Date.now()}`)
                        .setLabel('❌ キャンセル')
                        .setStyle(ButtonStyle.Danger)
                );

            const confirmMsg = await interaction.editReply({ embeds: [embed], components: [row] });

            const pendingWarnData = {
                targetId: target.id,
                moderatorId: interaction.user.id,
                reason: reason,
                content: content,
                context: context,
                messageId: targetMessageId,
                confirmMsgId: confirmMsg.id
            };

            pendingWarnsCache.set(confirmMsg.id, pendingWarnData, CONFIG.PENDING_WARNS_CACHE_TTL);

            // 期限切れ処理
            setTimeout(() => {
                if (pendingWarnsCache.has(confirmMsg.id)) {
                    pendingWarnsCache.delete(confirmMsg.id);
                    confirmMsg.edit({ components: [] }).catch(() => { });
                }
            }, CONFIG.PENDING_WARNS_CACHE_TTL);

            return;
        }

        // 警告実行
        try {
            await executeManualWarn(interaction, target, reason, content, context, targetMessageId);
            const count = getActiveWarningCount(target.id);
            // executeManualWarn内でメッセージ送信している場合もあるが、interactionへの応答として改めて返す
            await interaction.editReply({ content: `✅ 警告を発行しました (現在の警告数: ${count}/${CONFIG.WARN_THRESHOLD})` });
        } catch (error) {
            logger.error('警告実行エラー', { error: error.message });
            await interaction.editReply({ content: '❌ 警告の実行中にエラーが発生しました。' });
        }
    },
};
