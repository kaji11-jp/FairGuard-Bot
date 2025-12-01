const { isAdminUser } = require('../utils/permissions');
const { removeOpenTicket } = require('../utils/tickets');
const { executeManualWarn } = require('./commands');
const { handleSlashCommand } = require('./slashCommands');
const { handleConfirmation } = require('../services/aiConfirmation');
const { pendingWarnsCache } = require('../utils/cache');
const logger = require('../utils/logger');
const db = require('../database');

async function handleInteraction(interaction) {
    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
        return handleSlashCommand(interaction);
    }
    
    // ボタンインタラクション処理
    if (!interaction.isButton()) return;
    
    // AI確認フロー
    if (interaction.customId.startsWith('ai_confirm_')) {
        const confirmationId = interaction.customId.replace('ai_confirm_', '');
        return handleConfirmation(interaction, confirmationId, true);
    }
    
    if (interaction.customId.startsWith('ai_reject_')) {
        const confirmationId = interaction.customId.replace('ai_reject_', '');
        return handleConfirmation(interaction, confirmationId, false);
    }
    
    // チケット閉鎖
    if (interaction.customId === 'close_ticket') {
        const uid = db.prepare('SELECT user_id FROM tickets WHERE channel_id = ?').get(interaction.channel.id)?.user_id;
        interaction.reply('Closing...');
        setTimeout(() => {
            if(uid) removeOpenTicket(uid);
            interaction.channel.delete().catch(()=>{});
        }, 2000);
        return;
    }
    
    // 警告確認ボタン
    if (interaction.customId.startsWith('warn_confirm_')) {
        const warnData = pendingWarnsCache.get(interaction.message.id);
        
        if (!warnData || !interaction.message.author) { 
            return interaction.reply({ content: '❌ この警告リクエストは期限切れです', ephemeral: true });
        }
        
        if (!isAdminUser(interaction.member)) {
            return interaction.reply({ content: '❌ あなたにはこの操作を実行する権限がありません', ephemeral: true });
        }
        
        try {
            const target = await interaction.guild.members.fetch(warnData.targetId).catch(() => null);
            if (!target) {
                return interaction.reply({ content: '❌ 対象ユーザーが見つかりません', ephemeral: true });
            }
            
            await executeManualWarn(interaction.message, target.user, warnData.reason, warnData.content, warnData.context, warnData.messageId, warnData.moderatorId);
            pendingWarnsCache.delete(interaction.message.id);
            
            await interaction.update({ content: '✅ 警告を実行しました', components: [], embeds: [] });
        } catch (error) {
            logger.error('警告実行エラー（インタラクション）', { 
                error: error.message,
                stack: error.stack 
            });
            await interaction.reply({ content: '❌ 警告の実行中にエラーが発生しました', ephemeral: true });
        }
        return;
    }
    
    // 警告キャンセルボタン
    if (interaction.customId.startsWith('warn_cancel_')) {
        if (!pendingWarnsCache.has(interaction.message.id)) {
            return interaction.reply({ content: '❌ この警告リクエストは期限切れです', ephemeral: true });
        }
        
        pendingWarnsCache.delete(interaction.message.id);
        await interaction.update({ content: '❌ 警告がキャンセルされました', components: [], embeds: [] });
        return;
    }
}

module.exports = { handleInteraction };

