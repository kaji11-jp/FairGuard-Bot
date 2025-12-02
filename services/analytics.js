const { EmbedBuilder } = require('discord.js');
const db = require('../database');

// 警告相関分析
function generateAnalyticsReport(guildId, days = 30) {
    const now = Date.now();
    const startTime = now - (days * 24 * 60 * 60 * 1000);
    
    // 最も多い警告タイプ（guild_idがない場合は全件）
    const topWarningTypes = db.prepare(`
        SELECT type, COUNT(*) as count FROM mod_logs 
        WHERE timestamp > ?
        GROUP BY type
        ORDER BY count DESC
        LIMIT 5
    `).all(startTime);
    
    // 最もトラブルの多いユーザー
    const topTroubleUsers = db.prepare(`
        SELECT user_id, COUNT(*) as count FROM mod_logs 
        WHERE timestamp > ?
        GROUP BY user_id
        ORDER BY count DESC
        LIMIT 5
    `).all(startTime);
    
    // 時間帯別の警告分布（簡易版：時間帯ごとの集計）
    const hourlyDistribution = db.prepare(`
        SELECT 
            CAST((timestamp / 3600000) % 24 AS INTEGER) as hour,
            COUNT(*) as count
        FROM mod_logs
        WHERE timestamp > ?
        GROUP BY hour
        ORDER BY hour
    `).all(startTime);
    
    // 禁止ワードによる警告の統計（mod_logsからtypeで集計）
    // 注意: mod_logsテーブルにはwordカラムがないため、type別の集計のみ
    const topWords = db.prepare(`
        SELECT type, COUNT(*) as count FROM mod_logs
        WHERE type IN ('BLACKLIST', 'AI_JUDGE') AND timestamp > ?
        GROUP BY type
        ORDER BY count DESC
        LIMIT 5
    `).all(startTime);
    
    return {
        topWarningTypes,
        topTroubleUsers,
        hourlyDistribution,
        topWords,
        period: days
    };
}

// レポートをEmbed形式で生成
function createAnalyticsEmbed(report, guild) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📊 警告相関分析レポート')
        .setDescription(`過去${report.period}日間の統計データ`)
        .setTimestamp();
    
    // 警告タイプ
    if (report.topWarningTypes.length > 0) {
        const typesText = report.topWarningTypes.map(t => `**${t.type}**: ${t.count}回`).join('\n');
        embed.addFields({ name: '🔝 最も多い警告タイプ', value: typesText || 'なし', inline: false });
    }
    
    // トラブルユーザー
    if (report.topTroubleUsers.length > 0) {
        const usersText = report.topTroubleUsers.map(u => {
            const member = guild.members.cache.get(u.user_id);
            return `**${member?.user?.tag || u.user_id}**: ${u.count}回`;
        }).join('\n');
        embed.addFields({ name: '⚠️ トラブルの多いユーザー', value: usersText || 'なし', inline: false });
    }
    
    // 時間帯分布
    if (report.hourlyDistribution.length > 0) {
        const hoursText = report.hourlyDistribution.map(h => `${h.hour}時: ${h.count}回`).join(', ');
        embed.addFields({ name: '⏰ 時間帯別分布', value: hoursText || 'なし', inline: false });
    }
    
    // 禁止ワードタイプ別の統計
    if (report.topWords.length > 0) {
        const wordsText = report.topWords.map(w => `**${w.type}**: ${w.count}回`).join('\n');
        embed.addFields({ name: '🚫 禁止ワードタイプ別検知数', value: wordsText || 'なし', inline: false });
    }
    
    return embed;
}

module.exports = {
    generateAnalyticsReport,
    createAnalyticsEmbed
};

