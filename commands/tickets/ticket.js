const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../../config');
const { getOpenTicket, setOpenTicket } = require('../../utils/tickets');
const { isAdminUser } = require('../../utils/permissions');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('チケット管理')
        .addSubcommand(subcommand =>
            subcommand
                .setName('open')
                .setDescription('新しいチケットを作成'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('close')
                .setDescription('チケットを閉鎖（管理者専用）')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const isAdmin = isAdminUser(interaction.member);

        if (subcommand === 'open') {
            if (getOpenTicket(interaction.user.id)) {
                return interaction.reply({ content: '❌ 既に開いています', ephemeral: true });
            }

            if (!CONFIG.TICKET_CATEGORY_ID || CONFIG.TICKET_CATEGORY_ID.length === 0) {
                return interaction.reply({ content: '❌ チケットカテゴリーIDが設定されていません。管理者に連絡してください。', ephemeral: true });
            }

            await interaction.deferReply();

            const ch = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CONFIG.TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            setOpenTicket(interaction.user.id, ch.id);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));

            // フルモードの場合、AI一次対応を追加
            if (CONFIG.AI_TICKET_RESPONSE_ENABLED) {
                try {
                    const { handleAITicketResponse } = require('../../services/ticketAI');
                    const aiResponse = await handleAITicketResponse(ch, interaction.user, 'チケットを作成しました');
                    if (aiResponse) {
                        ch.send({ content: `${interaction.user} お問い合わせをどうぞ`, embeds: [aiResponse], components: [row] });
                    } else {
                        throw new Error('AI response null');
                    }
                } catch (e) {
                    // サービス読み込み失敗などのフォールバック
                    ch.send({ content: `${interaction.user} お問い合わせをどうぞ`, components: [row] });
                }
            } else {
                ch.send({ content: `${interaction.user} お問い合わせをどうぞ`, components: [row] });
            }

            return interaction.editReply({ content: `✅ チケット作成: ${ch}` });
        }

        if (subcommand === 'close' && isAdmin) {
            await interaction.deferReply();
            await interaction.channel.delete().catch(error => {
                logger.error('チケットチャンネル削除エラー（スラッシュコマンド）', {
                    channelId: interaction.channel.id,
                    error: error.message,
                    stack: error.stack
                });
            });
            return;
        }
    },
};
