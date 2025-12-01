const { EmbedBuilder, ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config');
const { isAdminUser } = require('../utils/permissions');
const { checkRateLimit } = require('../utils/rateLimit');
const { saveCommandLog, saveModLog } = require('../utils/logs');
const { getOpenTicket, setOpenTicket, removeOpenTicket } = require('../utils/tickets');
const { addWarning, reduceWarning, getActiveWarningCount } = require('../services/warnings');
const { fetchContext, callGemini, checkWarnAbuse } = require('../services/ai');
const { blacklistCache, graylistCache, loadBannedWords } = require('../utils/bannedWords');
const { executeManualWarn } = require('./commands');
const db = require('../database');

async function handleSlashCommand(interaction) {
    const commandName = interaction.commandName;
    const isAdmin = isAdminUser(interaction.member);
    
    // レート制限チェック（管理者は除外）
    if (!isAdmin) {
        if (!checkRateLimit(interaction.user.id)) {
            saveCommandLog(interaction.user.id, 'RATE_LIMIT', [], interaction.guild.id, interaction.channel.id, false);
            return interaction.reply({ content: '⏱️ コマンドの実行頻度が高すぎます。しばらく待ってから再試行してください。', ephemeral: true });
        }
    }
    
    // コマンドログ保存
    try {
        const options = interaction.options.data.map(opt => {
            if (opt.user) return opt.user.id;
            if (opt.value) return opt.value;
            return null;
        }).filter(v => v !== null);
        saveCommandLog(interaction.user.id, commandName, options, interaction.guild.id, interaction.channel.id, true);
    } catch (e) {
        console.error('Command log save error:', e);
    }
    
    // helpコマンド
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📜 コマンド一覧')
            .addFields({ name: '👤 ユーザー用', value: '`/appeal`: 異議申し立て\n`/ticket open`: 問い合わせ作成' });

        if (isAdmin) {
            embed.addFields({ 
                name: '👮 管理者用', 
                value: '`/warn`: 手動警告\n`/unwarn`: 警告減\n`/addword`: ワード追加\n`/removeword`: ワード削除\n`/listword`: 一覧表示\n`/timeout`: タイムアウト\n`/cmdlog`: コマンド履歴\n`/warnlog`: 警告履歴\n`/ticket close`: チケット終了' 
            });
            embed.setColor('#ff9900');
        }
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // appealコマンド
    if (commandName === 'appeal') {
        const logId = interaction.options.getString('log_id');
        const reason = interaction.options.getString('reason');
        
        if (!logId || !reason) {
            return interaction.reply({ content: '❌ 理由を入力してください', ephemeral: true });
        }

        const log = db.prepare('SELECT * FROM mod_logs WHERE id = ?').get(logId);
        if (!log || log.user_id !== interaction.user.id) {
            return interaction.reply({ content: '❌ データなし', ephemeral: true });
        }
        if (log.is_resolved) {
            return interaction.reply({ content: '✅ 既に解決済みです', ephemeral: true });
        }
        
        const APPEAL_DEADLINE_MS = 3 * 24 * 60 * 60 * 1000; 
        const timeSincePunishment = Date.now() - log.timestamp;
        if (timeSincePunishment > APPEAL_DEADLINE_MS) {
            const daysPassed = Math.floor(timeSincePunishment / (24 * 60 * 60 * 1000));
            return interaction.reply({ content: `❌ 異議申し立ての期限（3日以内）を過ぎています。処罰から${daysPassed}日経過しています。`, ephemeral: true });
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
    }
    
    // ticketコマンド
    if (commandName === 'ticket') {
        const subcommand = interaction.options.getSubcommand();
        
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
            ch.send({ content: `${interaction.user} お問い合わせをどうぞ`, components: [row] });
            return interaction.editReply({ content: `✅ チケット作成: ${ch}` });
        }
        
        if (subcommand === 'close' && isAdmin) {
            await interaction.deferReply();
            await interaction.channel.delete().catch(() => {});
            return;
        }
    }
    
    // 管理者専用コマンド
    if (!isAdmin) {
        return interaction.reply({ content: '❌ このコマンドは管理者専用です', ephemeral: true });
    }
    
    // warnコマンド
    if (commandName === 'warn') {
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
                    return interaction.editReply({ content: '❌ リプライ先のメッセージが対象ユーザーのものではありません' });
                }
                content = replyMsg.content;
                targetMessageId = replyMsg.id;
                context = await fetchContext(interaction.channel, replyMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return interaction.editReply({ content: '❌ メッセージの取得に失敗しました' });
            }
        } else {
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 50 });
                const targetMessages = messages.filter(m => m.author.id === target.id && !m.author.bot);
                
                if (targetMessages.size === 0) {
                    return interaction.editReply({ content: '❌ 対象ユーザーのメッセージが見つかりませんでした' });
                }
                
                const latestMsg = targetMessages.first();
                content = latestMsg.content;
                targetMessageId = latestMsg.id;
                context = await fetchContext(interaction.channel, latestMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return interaction.editReply({ content: '❌ メッセージの取得に失敗しました' });
            }
        }
        
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentWarns = db.prepare(`
            SELECT COUNT(*) as count, MAX(timestamp) as last_warn 
            FROM mod_logs 
            WHERE user_id = ? AND type = 'WARN_MANUAL' AND moderator_id = ? AND timestamp > ?
        `).get(target.id, interaction.user.id, oneHourAgo);
        
        const abuseCheck = await checkWarnAbuse(interaction.user.id, target.id, reason, context, content);
        
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
            
            if (!global.pendingWarns) global.pendingWarns = new Map();
            global.pendingWarns.set(confirmMsg.id, pendingWarnData);
            
            setTimeout(() => {
                if (global.pendingWarns && global.pendingWarns.has(confirmMsg.id)) {
                    global.pendingWarns.delete(confirmMsg.id);
                    confirmMsg.edit({ components: [] }).catch(() => {});
                }
            }, 5 * 60 * 1000);
            
            return;
        }
        
        await executeManualWarn(interaction, target, reason, content, context, targetMessageId);
        const count = getActiveWarningCount(target.id);
        return interaction.editReply({ content: `✅ 警告を発行しました (警告回数: ${count}/${CONFIG.WARN_THRESHOLD})` });
    }
    
    // unwarnコマンド
    if (commandName === 'unwarn') {
        const userId = interaction.options.getString('user_id');
        const amount = interaction.options.getInteger('amount') || 1;
        
        if (amount < 1) {
            return interaction.reply({ content: '❌ 減らす数は1以上である必要があります', ephemeral: true });
        }
        
        const target = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!target) {
            return interaction.reply({ content: '❌ ユーザーが見つかりません', ephemeral: true });
        }
        
        const newCount = reduceWarning(userId, amount);
        
        const logId = Date.now().toString(36);
        saveModLog({
            id: logId, 
            type: 'UNWARN', 
            userId: userId, 
            moderatorId: interaction.user.id, 
            timestamp: Date.now(), 
            reason: `${amount}個の警告を削減`, 
            content: '', 
            contextData: '', 
            aiAnalysis: null
        });
        
        return interaction.reply({ content: `✅ ${target.user} の警告を${amount}個削減しました (現在: ${newCount})`, ephemeral: true });
    }
    
    // listwordコマンド
    if (commandName === 'listword') {
        const blackList = Array.from(blacklistCache).join(', ') || 'なし';
        const grayList = Array.from(graylistCache).join(', ') || 'なし';
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle('📜 禁止ワード一覧')
            .addFields({ name: '🚫 即死 (Blacklist)', value: blackList }, { name: '⚡ AI審議 (Graylist)', value: grayList });
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // addwordコマンド
    if (commandName === 'addword') {
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
    }
    
    // removewordコマンド
    if (commandName === 'removeword') {
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
    }
    
    // timeoutコマンド
    if (commandName === 'timeout') {
        const userId = interaction.options.getString('user_id');
        
        const mem = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!mem) {
            return interaction.reply({ content: '❌ ユーザーが見つかりません', ephemeral: true });
        }
        
        if (isAdminUser(mem)) {
            return interaction.reply({ content: '❌ 管理者をタイムアウトすることはできません', ephemeral: true });
        }
        
        try {
            await mem.timeout(CONFIG.TIMEOUT_DURATION, `手動タイムアウト by ${interaction.user.tag}`);
            
            const logId = Date.now().toString(36);
            saveModLog({
                id: logId, 
                type: 'TIMEOUT', 
                userId: userId, 
                moderatorId: interaction.user.id, 
                timestamp: Date.now(), 
                reason: '手動タイムアウト', 
                content: '', 
                contextData: '', 
                aiAnalysis: null
            });
            
            return interaction.reply({ content: `🔨 ${mem.user} をタイムアウトしました (${CONFIG.TIMEOUT_DURATION / 1000 / 60}分)`, ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: `❌ タイムアウトの実行に失敗しました: ${e.message}`, ephemeral: true });
        }
    }
    
    // cmdlogコマンド
    if (commandName === 'cmdlog') {
        const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);
        const logs = db.prepare('SELECT * FROM command_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?').all(interaction.guild.id, limit);
        
        if (logs.length === 0) {
            return interaction.reply({ content: '📝 コマンド履歴がありません', ephemeral: true });
        }
        
        const warnLogs = logs.filter(log => log.command === 'warn' && log.success === 1);
        const warnFrequency = {};
        warnLogs.forEach(log => {
            const args = JSON.parse(log.args || '[]');
            const targetId = args[0]?.replace(/[<@!>]/g, '') || 'unknown';
            if (!warnFrequency[targetId]) {
                warnFrequency[targetId] = { count: 0, times: [] };
            }
            warnFrequency[targetId].count++;
            warnFrequency[targetId].times.push(log.timestamp);
        });
        
        const logText = logs.map(log => {
            const user = interaction.guild.members.cache.get(log.user_id);
            const date = new Date(log.timestamp).toLocaleString('ja-JP', { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
            const args = JSON.parse(log.args || '[]');
            const argsText = args.length > 0 ? args.join(' ') : '';
            const commandText = argsText ? `/${log.command} ${argsText}` : `/${log.command}`;
            return `\`${date}\` **${user?.user?.tag || log.user_id}**: \`${commandText}\` ${log.success ? '✅' : '❌'}`;
        }).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📝 コマンド履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: `最新${logs.length}件表示` });
        
        const frequentWarns = Object.entries(warnFrequency).filter(([_, data]) => data.count >= 2);
        if (frequentWarns.length > 0) {
            const warnText = frequentWarns.map(([targetId, data]) => {
                const target = interaction.guild.members.cache.get(targetId);
                const timeDiff = Math.max(...data.times) - Math.min(...data.times);
                const minutes = Math.floor(timeDiff / 60000);
                return `**${target?.user?.tag || targetId}**: ${data.count}回 (${minutes}分以内)`;
            }).join('\n');
            
            embed.addFields({ 
                name: '⚠️ 警告頻度が高いユーザー', 
                value: warnText.length > 1024 ? warnText.substring(0, 1024) + '...' : warnText || 'なし',
                inline: false 
            });
        }
        
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // warnlogコマンド
    if (commandName === 'warnlog') {
        const targetId = interaction.options.getString('user_id');
        const limit = Math.min(interaction.options.getInteger('limit') || 10, 50);
        
        let logs;
        if (targetId) {
            logs = db.prepare('SELECT * FROM mod_logs WHERE user_id = ? AND type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all(targetId, 'WARN%', limit);
        } else {
            logs = db.prepare('SELECT * FROM mod_logs WHERE type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all('WARN%', limit);
        }
        
        if (logs.length === 0) {
            return interaction.reply({ content: '📝 警告履歴がありません', ephemeral: true });
        }
        
        const logText = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('ja-JP', { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const moderator = interaction.guild.members.cache.get(log.moderator_id);
            const target = interaction.guild.members.cache.get(log.user_id);
            return `\`${date}\` ${target?.user?.tag || log.user_id} ← ${moderator?.user?.tag || log.moderator_id}\n理由: ${log.reason}\nID: \`${log.id}\``;
        }).join('\n\n');
        
        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('⚠️ 警告履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: targetId ? `対象: ${targetId}` : `最新${logs.length}件` });
        
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

module.exports = { handleSlashCommand };

