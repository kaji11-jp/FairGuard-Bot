const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');

/**
 * 警告メッセージ用のEmbedを作成する共通関数
 * @param {Object} options - オプション
 * @param {Object} options.user - 警告対象のユーザー
 * @param {string} options.reason - 警告理由
 * @param {number} options.warnCount - 現在の警告回数
 * @param {string} options.logId - ログID
 * @param {string} options.type - 警告タイプ（'WARN', 'BLACKLIST', 'AI_JUDGE'など）
 * @param {string} [options.word] - 検知ワード（オプション）
 * @param {Object} [options.aiResult] - AI判定結果（オプション）
 * @returns {EmbedBuilder} 作成されたEmbed
 */
function createWarningEmbed({ user, reason, warnCount, logId, type, word = null, aiResult = null }) {
    const embed = new EmbedBuilder();
    
    // タイプに応じた色とタイトルを設定
    if (type === 'BLACKLIST') {
        embed.setColor('#ff9900')
            .setTitle('⚠️ 警告 (禁止ワード)');
    } else if (type === 'AI_JUDGE' || type === 'AI_JUDGE_CONFIRMED') {
        embed.setColor('#FF9900')
            .setTitle('⚡ AI警告');
    } else if (type === 'WARN_MANUAL') {
        embed.setColor('#ff9900')
            .setTitle('⚠️ 手動警告');
    } else {
        embed.setColor('#ff9900')
            .setTitle('⚠️ 警告');
    }
    
    // 説明文を設定
    if (type === 'WARN_MANUAL') {
        embed.setDescription(`${user} に警告が発行されました`);
    } else {
        embed.setDescription(`${user} の発言が検知されました。`);
    }
    
    // フィールドを追加
    const fields = [];
    
    if (word) {
        fields.push({ name: '検知ワード', value: `\`${word}\``, inline: true });
    }
    
    fields.push(
        { name: '理由', value: reason, inline: word ? true : false },
        { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
        { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
    );
    
    if (type === 'WARN_MANUAL') {
        fields.push({ name: '警告ID', value: `\`${logId}\``, inline: false });
    }
    
    embed.addFields(fields);
    
    // AI判定結果がある場合はフッターを設定
    if (aiResult) {
        embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
    }
    
    return embed;
}

/**
 * 警告削除メッセージ用のEmbedを作成する共通関数
 * @param {Object} options - オプション
 * @param {Object} options.user - 警告対象のユーザー
 * @param {string} options.reason - 警告理由
 * @param {number} options.warnCount - 現在の警告回数
 * @param {string} options.logId - ログID
 * @param {string} options.type - 警告タイプ
 * @param {string} [options.word] - 検知ワード（オプション）
 * @param {Object} [options.aiResult] - AI判定結果（オプション）
 * @returns {EmbedBuilder} 作成されたEmbed
 */
function createWarningDeleteEmbed({ user, reason, warnCount, logId, type, word = null, aiResult = null }) {
    const embed = new EmbedBuilder();
    
    // タイプに応じた色とタイトルを設定
    if (type === 'BLACKLIST') {
        embed.setColor('#ff0000')
            .setTitle('🚫 警告 (自動削除)');
    } else {
        embed.setColor('#FF4500')
            .setTitle('⚡ AI警告 (削除)');
    }
    
    embed.setDescription(`${user} の発言は削除されました。`);
    
    // フィールドを追加
    const fields = [];
    
    if (word) {
        fields.push({ name: '検知ワード', value: `\`${word}\``, inline: true });
    }
    
    fields.push(
        { name: '理由', value: reason, inline: word ? true : false },
        { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
        { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
    );
    
    embed.addFields(fields);
    
    // AI判定結果がある場合はフッターを設定
    if (aiResult) {
        embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
    }
    
    return embed;
}

module.exports = {
    createWarningEmbed,
    createWarningDeleteEmbed
};

