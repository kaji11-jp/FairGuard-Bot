const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config');
const db = require('../database');
const { callGemini } = require('./ai');
const logger = require('../utils/logger');

// AI確認フロー（2段階警告）
async function requestAIConfirmation(message, aiResult, context, word) {
    if (!CONFIG.AI_CONFIRMATION_ENABLED) {
        return null; // フルモードでない場合はスキップ
    }
    
    const confirmationId = Date.now().toString(36);
    
    // 確認リクエストをデータベースに保存
    try {
        db.prepare(`
            INSERT INTO ai_confirmations (id, message_id, user_id, moderator_id, status, timestamp, ai_analysis, context_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(confirmationId, message.id, message.author.id, 'AI', 'pending', Date.now(), JSON.stringify(aiResult), context);
    } catch (error) {
        logger.error('AI確認リクエスト保存エラー', {
            confirmationId,
            messageId: message.id,
            userId: message.author.id,
            error: error.message,
            stack: error.stack
        });
        return null; // エラー時はnullを返して処理をスキップ
    }
    
    const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('⚠️ AI警告 - 管理者確認が必要です')
        .setDescription(`**${message.author}** の発言がAIによってハラスメントの可能性があると判定されました。`)
        .addFields(
            { name: '検知ワード', value: `\`${word}\``, inline: true },
            { name: 'AI判定理由', value: aiResult.reason || '判定理由なし', inline: false },
            { name: '確認ID', value: `\`${confirmationId}\``, inline: false }
        )
        .setFooter({ text: '管理者が承認または拒否を選択してください', iconURL: CONFIG.GEMINI_ICON });
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`ai_confirm_${confirmationId}`)
                .setLabel('✅ 承認して警告')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`ai_reject_${confirmationId}`)
                .setLabel('❌ 拒否（警告しない）')
                .setStyle(ButtonStyle.Danger)
        );
    
    return { embed, row, confirmationId };
}

// 確認結果の処理
async function handleConfirmation(interaction, confirmationId, approved) {
    let confirmation;
    try {
        confirmation = db.prepare('SELECT * FROM ai_confirmations WHERE id = ?').get(confirmationId);
    } catch (error) {
        logger.error('AI確認リクエスト取得エラー', {
            confirmationId,
            error: error.message,
            stack: error.stack
        });
        return interaction.reply({ content: '❌ データベースエラーが発生しました', ephemeral: true });
    }
    
    if (!confirmation || confirmation.status !== 'pending') {
        return interaction.reply({ content: '❌ この確認リクエストは無効または既に処理済みです', ephemeral: true });
    }
    
    // ステータス更新
    try {
        db.prepare('UPDATE ai_confirmations SET status = ?, moderator_id = ? WHERE id = ?')
            .run(approved ? 'approved' : 'rejected', interaction.user.id, confirmationId);
    } catch (error) {
        logger.error('AI確認ステータス更新エラー', {
            confirmationId,
            approved,
            error: error.message,
            stack: error.stack
        });
        return interaction.reply({ content: '❌ ステータス更新中にエラーが発生しました', ephemeral: true });
    }
    
    if (approved) {
        // 警告を実行
        const { addWarning, getActiveWarningCount } = require('./warnings');
        const { saveModLog } = require('../utils/logs');
        const { fetchContext } = require('./ai');
        
        try {
            const channel = interaction.channel;
            const message = await channel.messages.fetch(confirmation.message_id).catch(() => null);
            
            if (message) {
                const context = await fetchContext(channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
                const logId = Date.now().toString(36);
                
                let aiAnalysisParsed;
                let reason;
                try {
                    aiAnalysisParsed = JSON.parse(confirmation.ai_analysis);
                    reason = aiAnalysisParsed.reason || 'AI判定による警告';
                } catch (parseError) {
                    logger.error('AI分析データのJSON解析エラー', {
                        confirmationId,
                        error: parseError.message,
                        stack: parseError.stack
                    });
                    reason = 'AI判定による警告（解析エラー）';
                    aiAnalysisParsed = { reason: reason };
                }
                
                saveModLog({
                    id: logId,
                    type: 'AI_JUDGE_CONFIRMED',
                    userId: message.author.id,
                    moderatorId: interaction.user.id,
                    timestamp: Date.now(),
                    reason: reason,
                    content: message.content,
                    contextData: context,
                    aiAnalysis: confirmation.ai_analysis
                });
                
                const warnCount = addWarning(message.author.id, reason, interaction.user.id, logId);
                
                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚡ AI警告（管理者承認済み）')
                    .setDescription(`${message.author} に警告が発行されました。`)
                    .addFields(
                        { name: '理由', value: reason, inline: false },
                        { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                        { name: '承認者', value: `${interaction.user}`, inline: true }
                    )
                    .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
                
                await channel.send({ embeds: [embed] });
            }
        } catch (e) {
            const logger = require('../utils/logger');
            logger.error('確認警告エラー', {
                confirmationId,
                userId: confirmation.user_id,
                error: e.message,
                stack: e.stack
            });
        }
    }
    
    await interaction.update({ 
        content: approved ? '✅ 警告を承認して実行しました' : '❌ 警告を拒否しました', 
        components: [],
        embeds: [] 
    });
}

module.exports = {
    requestAIConfirmation,
    handleConfirmation
};

