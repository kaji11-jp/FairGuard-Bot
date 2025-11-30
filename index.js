const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

// --- 0. 環境チェック ---
if (
    !process.env.BOT_TOKEN || 
    !process.env.GEMINI_API_KEY ||
    !process.env.DISCORD_GUILD_ID ||
    !process.env.DISCORD_ADMIN_ROLE_ID ||
    !process.env.DISCORD_ALERT_CHANNEL_ID ||
    !process.env.DISCORD_TICKET_CATEGORY_ID
) {
    console.error('❌ .env に必要な設定が不足しています。README.md または .env.example を確認してください。');
    const missing = [];
    if (!process.env.BOT_TOKEN) missing.push('BOT_TOKEN');
    if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
    if (!process.env.DISCORD_GUILD_ID) missing.push('DISCORD_GUILD_ID');
    if (!process.env.DISCORD_ADMIN_ROLE_ID) missing.push('DISCORD_ADMIN_ROLE_ID');
    if (!process.env.DISCORD_ALERT_CHANNEL_ID) missing.push('DISCORD_ALERT_CHANNEL_ID');
    if (!process.env.DISCORD_TICKET_CATEGORY_ID) missing.push('DISCORD_TICKET_CATEGORY_ID');
    console.error(`不足している変数: ${missing.join(', ')}`);
    process.exit(1);
}

// --- 1. データベース初期化 ---
const db = new Database('bot_data.sqlite');

// テーブル作成
db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (user_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS warning_records (
        id TEXT PRIMARY KEY, user_id TEXT, timestamp INTEGER, expires_at INTEGER, 
        reason TEXT, moderator_id TEXT, log_id TEXT
    );
    CREATE TABLE IF NOT EXISTS mod_logs (
        id TEXT PRIMARY KEY, type TEXT, user_id TEXT, moderator_id TEXT, 
        timestamp INTEGER, reason TEXT, content TEXT, context_data TEXT, 
        ai_analysis TEXT, is_resolved INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tickets (user_id TEXT PRIMARY KEY, channel_id TEXT);
    CREATE TABLE IF NOT EXISTS banned_words (word TEXT PRIMARY KEY, type TEXT DEFAULT 'BLACK');
    CREATE TABLE IF NOT EXISTS command_rate_limits (user_id TEXT PRIMARY KEY, last_command_time INTEGER, command_count INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS command_logs (
        id TEXT PRIMARY KEY, user_id TEXT, command TEXT, args TEXT, 
        timestamp INTEGER, guild_id TEXT, channel_id TEXT, success INTEGER
    );
    CREATE TABLE IF NOT EXISTS message_tracking (
        user_id TEXT, channel_id TEXT, timestamp INTEGER, message_length INTEGER,
        PRIMARY KEY (user_id, channel_id, timestamp)
    );
`);


// --- 2. 設定 (CONFIG) ---
const CONFIG = {
    PREFIX: "!",
    WARN_THRESHOLD: 3,
    TIMEOUT_DURATION: 60 * 60 * 1000, 

    ALLOWED_GUILD_ID: process.env.DISCORD_GUILD_ID, 
    ADMIN_USER_IDS: process.env.DISCORD_ADMIN_USER_IDS ? process.env.DISCORD_ADMIN_USER_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0) : [], 
    ADMIN_ROLE_ID: process.env.DISCORD_ADMIN_ROLE_ID, 
    
    ALERT_CHANNEL_ID: process.env.DISCORD_ALERT_CHANNEL_ID, 
    TICKET_CATEGORY_ID: process.env.DISCORD_TICKET_CATEGORY_ID, 

    // Gemini API設定
    GEMINI_API_URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, 
    GEMINI_CREDIT: "🛡️ AI Analysis Powered by Google Gemini",
    GEMINI_ICON: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg",
    
    // セキュリティ設定
    COMMAND_RATE_LIMIT: 5, 
    COMMAND_RATE_WINDOW: 60 * 1000, 
    WARN_CONTEXT_BEFORE: 10, 
    WARN_CONTEXT_AFTER: 10,
    
    // 長文・連投検出設定
    MAX_MESSAGE_LENGTH: 2000, 
    SPAM_MESSAGE_COUNT: 5, 
    SPAM_TIME_WINDOW: 10 * 1000, 
    MUTE_DURATION: 30 * 60 * 1000 
};

// --- 3. キャッシュ管理 & ロード関数 ---
let blacklistCache = new Set();
let graylistCache = new Set();
const DEFAULT_GRAY_WORDS = ["死ね", "殺す", "ゴミ", "カス", "うざい", "きもい", "ガイジ", "馬鹿", "アホ", "kill", "noob"];

const loadBannedWords = () => {
    blacklistCache.clear();
    graylistCache.clear();
    const rows = db.prepare('SELECT word, type FROM banned_words').all();
    
    if (rows.length === 0) {
        const insert = db.prepare('INSERT OR IGNORE INTO banned_words (word, type) VALUES (?, ?)');
        DEFAULT_GRAY_WORDS.forEach(w => insert.run(w, 'GRAY'));
        DEFAULT_GRAY_WORDS.forEach(w => graylistCache.add(w));
    } else {
        rows.forEach(row => {
            if (row.type === 'GRAY') graylistCache.add(row.word);
            else blacklistCache.add(row.word);
        });
    }
};
loadBannedWords();

// --- 4. ヘルパー関数 ---

// 管理者チェック（ロールIDまたはユーザーID）
function isAdminUser(member) {
    if (!member) return false;
    const validAdminIds = CONFIG.ADMIN_USER_IDS.filter(id => id && id.trim() !== '');
    if (validAdminIds.includes(member.id)) return true;
    if (CONFIG.ADMIN_ROLE_ID && member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) return true;
    return false;
}

const WARNING_EXPIRY_DAYS = 30;
const WARNING_EXPIRY_MS = WARNING_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// 有効期限切れの警告を削除
const cleanupExpiredWarnings = () => {
    const now = Date.now();
    db.prepare('DELETE FROM warning_records WHERE expires_at < ?').run(now);
    
    const activeWarnings = db.prepare('SELECT user_id, COUNT(*) as count FROM warning_records WHERE expires_at >= ? GROUP BY user_id').all(now);
    
    db.prepare('DELETE FROM warnings').run();
    const updateStmt = db.prepare('INSERT INTO warnings (user_id, count) VALUES (?, ?)');
    activeWarnings.forEach(row => {
        updateStmt.run(row.user_id, row.count);
    });
};

// 警告を追加（有効期限付き）
const addWarning = (userId, reason = '', moderatorId = '', logId = '') => {
    const now = Date.now();
    const expiresAt = now + WARNING_EXPIRY_MS;
    const warningId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    cleanupExpiredWarnings();
    
    db.prepare('INSERT INTO warning_records (id, user_id, timestamp, expires_at, reason, moderator_id, log_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(warningId, userId, now, expiresAt, reason, moderatorId, logId);
    
    const activeCount = db.prepare('SELECT COUNT(*) as count FROM warning_records WHERE user_id = ? AND expires_at >= ?')
        .get(userId, now)?.count || 0;
    
    db.prepare('INSERT INTO warnings (user_id, count) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET count = ?')
        .run(userId, activeCount, activeCount);
    
    return activeCount;
};

// 警告を減らす
const reduceWarning = (userId, amount = 1) => {
    cleanupExpiredWarnings();
    
    const toDelete = db.prepare('SELECT id FROM warning_records WHERE user_id = ? AND expires_at >= ? ORDER BY timestamp ASC LIMIT ?')
        .all(userId, Date.now(), amount);
    
    toDelete.forEach(row => {
        db.prepare('DELETE FROM warning_records WHERE id = ?').run(row.id);
    });
    
    const activeCount = db.prepare('SELECT COUNT(*) as count FROM warning_records WHERE user_id = ? AND expires_at >= ?')
        .get(userId, Date.now())?.count || 0;
    
    if (activeCount === 0) {
        db.prepare('DELETE FROM warnings WHERE user_id = ?').run(userId);
    } else {
        db.prepare('UPDATE warnings SET count = ? WHERE user_id = ?').run(activeCount, userId);
    }
    
    return activeCount;
};

// 有効な警告数を取得
const getActiveWarningCount = (userId) => {
    cleanupExpiredWarnings();
    const row = db.prepare('SELECT count FROM warnings WHERE user_id = ?').get(userId);
    return row ? row.count : 0;
};

// ログ保存
const saveModLog = (log) => {
    db.prepare(`INSERT INTO mod_logs (id, type, user_id, moderator_id, timestamp, reason, content, context_data, ai_analysis, is_resolved) VALUES (@id, @type, @userId, @moderatorId, @timestamp, @reason, @content, @contextData, @aiAnalysis, 0)`)
      .run(log);
};

// コマンドログ保存
const saveCommandLog = (userId, command, args, guildId, channelId, success = true) => {
    const logId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    db.prepare(`INSERT INTO command_logs (id, user_id, command, args, timestamp, guild_id, channel_id, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(logId, userId, command, JSON.stringify(args), Date.now(), guildId, channelId, success ? 1 : 0);
};

// チケット管理
const getOpenTicket = (userId) => db.prepare('SELECT channel_id FROM tickets WHERE user_id = ?').get(userId)?.channel_id;
const setOpenTicket = (userId, channelId) => db.prepare('INSERT OR REPLACE INTO tickets (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
const removeOpenTicket = (userId) => db.prepare('DELETE FROM tickets WHERE user_id = ?').run(userId);

// レート制限チェック
function checkRateLimit(userId) {
    const now = Date.now();
    const row = db.prepare('SELECT * FROM command_rate_limits WHERE user_id = ?').get(userId);
    
    if (!row) {
        db.prepare('INSERT INTO command_rate_limits (user_id, last_command_time, command_count) VALUES (?, ?, 1)').run(userId, now);
        return true;
    }
    
    const timeDiff = now - row.last_command_time;
    if (timeDiff > CONFIG.COMMAND_RATE_WINDOW) {
        db.prepare('UPDATE command_rate_limits SET last_command_time = ?, command_count = 1 WHERE user_id = ?').run(now, userId);
        return true;
    }
    
    if (row.command_count >= CONFIG.COMMAND_RATE_LIMIT) {
        return false; 
    }
    
    db.prepare('UPDATE command_rate_limits SET command_count = command_count + 1 WHERE user_id = ?').run(userId);
    return true;
}

// 手動警告のAbuse判定
async function checkWarnAbuse(moderatorId, targetId, reason, context, content) {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentWarns = db.prepare(`
        SELECT COUNT(*) as count, MAX(timestamp) as last_warn 
        FROM mod_logs 
        WHERE user_id = ? AND type = 'WARN_MANUAL' AND moderator_id = ? AND timestamp > ?
    `).get(targetId, moderatorId, oneHourAgo);
    
    const frequencyWarning = recentWarns.count >= 2 ? `⚠️ 過去1時間以内に同じユーザーへの警告が${recentWarns.count}回記録されています。` : '';
    
    const prompt = `
あなたは管理者権限の濫用を検出するAIです。以下の手動警告が適切かどうかを判定してください。

【判定基準 - 厳格に適用してください】
1. **明確な理由がない**: 理由が曖昧、または不十分な場合は【ABUSE】です。
   - 「キモい」「うざい」「きもい」などの感情的な表現のみは【ABUSE】です
   - 「から」で終わる理由（例：「キモいから」「うざいから」）は【ABUSE】の可能性が高いです
2. **個人的な感情**: 私的な感情や偏見に基づく警告は【ABUSE】です。
   - 主観的な感情表現（「キモい」「うざい」「きもい」など）は【ABUSE】です
3. **過度な頻度**: 同じユーザーへの警告が短期間に集中している場合は【ABUSE】の可能性があります。
4. **文脈の無視**: 発言の文脈を無視した警告は【ABUSE】です。
5. **適切な警告**: 明確な違反があり、客観的で具体的な理由がある場合は【SAFE】です。
   - 例：「スパム行為」「ハラスメント」「ルール違反」など

【重要】
- 理由が「キモい」「うざい」「きもい」などの感情的な表現のみの場合は、必ず【ABUSE】として判定してください。
- 理由が「〜から」で終わり、その前が感情的な表現の場合は【ABUSE】です。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。
{"is_abuse": true or false, "reason": "日本語で詳細な理由を記述", "concerns": ["懸念点1", "懸念点2", ...]}

${frequencyWarning}

[警告理由]: ${reason}
[対象ユーザー]: ${targetId}
[警告者]: ${moderatorId}
[対象発言]: ${content}
[文脈]: ${context}
    `;
    
    return await callGemini(prompt);
}

// 文脈取得（前後指定数のメッセージを取得）
async function fetchContext(channel, messageId, beforeLimit = 10, afterLimit = 10) {
    try {
        const contextMessages = [];
        
        const beforeMessages = await channel.messages.fetch({ limit: beforeLimit, before: messageId });
        beforeMessages.forEach(m => contextMessages.push({ msg: m, order: 'before' }));
        
        try {
            const targetMsg = await channel.messages.fetch(messageId);
            contextMessages.push({ msg: targetMsg, order: 'target' });
        } catch {}
        
        const afterMessages = await channel.messages.fetch({ limit: afterLimit, after: messageId });
        afterMessages.forEach(m => contextMessages.push({ msg: m, order: 'after' }));
        
        contextMessages.sort((a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp);
        
        return contextMessages.map(({ msg, order }) => {
            const marker = order === 'target' ? '【対象】' : '';
            return `${marker}[${msg.author.tag}]: ${msg.content}`;
        }).join('\n');
    } catch (e) {
        console.error("Context fetch error:", e);
        return "文脈取得失敗";
    }
}

// Gemini API呼び出し
async function callGemini(prompt) {
    try {
        const systemInstruction = `あなたは日本語で応答するAIです。すべての応答は必ず日本語で行ってください。JSON形式で応答する場合も、理由や説明は日本語で記述してください。`;
        const fullPrompt = `${systemInstruction}\n\n${prompt}`;
        
        const response = await fetch(`${CONFIG.GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.3 
                },
                systemInstruction: {
                    parts: [{ text: "あなたは日本語で応答するAIです。すべての応答は必ず日本語で行ってください。" }]
                }
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("Gemini API HTTP Error:", response.status, errorData);
            return null;
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) {
            console.error("Gemini API: No text in response", data);
            return null;
        }
        
        const cleanedText = text.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (e) {
        console.error("Gemini API Error:", e);
        return null;
    }
}

// --- 5. メインクライアント処理 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🛡️  System Ready: Blacklist=${blacklistCache.size}, Graylist=${graylistCache.size}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (!message.guild) return;
    
    if (message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    
    try {
        if (message.content.startsWith(CONFIG.PREFIX)) {
            await handleCommand(message);
            return;
        }

        if (!isAdminUser(message.member)) {
            await checkSpamAndLongMessage(message);
        }

        if (!isAdminUser(message.member)) {
            await handleModeration(message);
        }
    } catch (error) {
        console.error('Message processing error:', error);
    }
});

// --- 6. 長文・連投検出（AI判定付き） ---
async function checkSpamAndLongMessage(message) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    if (isAdminUser(message.member)) return;
    
    const now = Date.now();
    const userId = message.author.id;
    const channelId = message.channel.id;
    const messageLength = message.content.length;
    
    db.prepare('INSERT INTO message_tracking (user_id, channel_id, timestamp, message_length) VALUES (?, ?, ?, ?)')
        .run(userId, channelId, now, messageLength);
    
    const timeWindow = now - CONFIG.SPAM_TIME_WINDOW;
    const recentMessages = db.prepare(`
        SELECT COUNT(*) as count FROM message_tracking 
        WHERE user_id = ? AND channel_id = ? AND timestamp > ?
    `).get(userId, channelId, timeWindow);
    
    const isLongMessage = messageLength > CONFIG.MAX_MESSAGE_LENGTH;
    const isSpamCandidate = recentMessages.count >= CONFIG.SPAM_MESSAGE_COUNT;
    
    if (isLongMessage || isSpamCandidate) {
        const prompt = `
あなたは公平なモデレーターAIです。以下の発言が「長文投稿」または「連投（スパム）」として処罰すべきか判定してください。

【判定基準】
1. **長文投稿**: 2000文字を超えるメッセージは原則として【PUNISH】ですが、以下の場合は【SAFE】です：
   - コードブロックや引用を含む技術的な説明
   - 重要な情報をまとめた正当な長文
   - 物語や創作活動の一環としての長文
2. **連投（スパム）**: 短時間に複数のメッセージを投稿している場合は原則として【PUNISH】ですが、以下の場合は【SAFE】です：
   - 会話の流れとして自然な連続投稿
   - 質問への回答として複数メッセージに分けている
   - 重要な情報を伝えるための連続投稿
3. **文脈の考慮**: 文脈を考慮し、正当な理由がある場合は【SAFE】としてください。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"verdict": "PUNISH" or "SAFE", "reason": "日本語で短い理由を記述", "type": "LONG_MESSAGE" or "SPAM" or "BOTH"}

[対象発言]: ${message.content}
[文字数]: ${messageLength}文字
[過去10秒以内のメッセージ数]: ${recentMessages.count}件
        `;
        
        const result = await callGemini(prompt);
        
        if (result && result.verdict === "PUNISH") {
            const currentWarnCount = getActiveWarningCount(userId);
            
            const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            
            if (currentWarnCount < 3) {
                const logId = Date.now().toString(36);
                
                saveModLog({
                    id: logId,
                    type: result.type === 'LONG_MESSAGE' ? 'LONG_MESSAGE' : result.type === 'SPAM' ? 'SPAM' : 'SPAM_LONG',
                    userId: userId,
                    moderatorId: client.user.id,
                    timestamp: Date.now(),
                    reason: result.reason,
                    content: message.content,
                    contextData: context,
                    aiAnalysis: JSON.stringify(result)
                });
                
                const newWarnCount = addWarning(userId, result.reason, client.user.id, logId);
                
                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle(`⚠️ ${result.type === 'LONG_MESSAGE' ? '長文投稿' : result.type === 'SPAM' ? '連投' : '長文・連投'}による警告`)
                    .setDescription(`${message.author} が${result.type === 'LONG_MESSAGE' ? '長文を投稿' : result.type === 'SPAM' ? '連投を行' : '長文投稿・連投を行'}いました。`)
                    .addFields(
                        { name: '理由', value: result.reason, inline: false },
                        { name: '警告回数', value: `${newWarnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                        { name: '文字数', value: `${messageLength}文字`, inline: true },
                        { name: 'メッセージ数', value: `${recentMessages.count}件/${CONFIG.SPAM_TIME_WINDOW / 1000}秒`, inline: true },
                        { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
                    )
                    .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
                
                message.channel.send({ embeds: [embed] });
            } else {
                try {
                    await message.delete();
                    const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
                    const logId = Date.now().toString(36);
                    
                    saveModLog({
                        id: logId,
                        type: result.type === 'LONG_MESSAGE' ? 'LONG_MESSAGE' : result.type === 'SPAM' ? 'SPAM' : 'SPAM_LONG',
                        userId: userId,
                        moderatorId: client.user.id,
                        timestamp: Date.now(),
                        reason: result.reason,
                        content: message.content,
                        contextData: context,
                        aiAnalysis: JSON.stringify(result)
                    });
                    
                    const newWarnCount = addWarning(userId, result.reason, client.user.id, logId);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle(`🚫 ${result.type === 'LONG_MESSAGE' ? '長文投稿' : result.type === 'SPAM' ? '連投' : '長文・連投'}による削除`)
                        .setDescription(`${message.author} の発言は削除されました。`)
                        .addFields(
                            { name: '理由', value: result.reason, inline: false },
                            { name: '警告回数', value: `${newWarnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                            { name: '文字数', value: `${messageLength}文字`, inline: true },
                            { name: 'メッセージ数', value: `${recentMessages.count}件/${CONFIG.SPAM_TIME_WINDOW / 1000}秒`, inline: true },
                            { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
                        )
                        .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
                    
                    message.channel.send({ embeds: [embed] });
                } catch (e) {
                    console.error('Spam/Long message punishment error:', e);
                }
            }
        } else {
            console.log(`[SAFE] ${message.author.tag}: ${isLongMessage ? '長文' : ''}${isSpamCandidate ? '連投' : ''} -> ${result?.reason || 'AI判定なし'}`);
        }
    }
    
    const oneHourAgo = now - (60 * 60 * 1000);
    db.prepare('DELETE FROM message_tracking WHERE timestamp < ?').run(oneHourAgo);
}

// --- 6. モデレーションロジック (AIハイブリッド) ---
async function handleModeration(message) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    if (isAdminUser(message.member)) return;
    
    const content = message.content.toLowerCase();
    
    // A. ブラックリスト (即死)
    for (const word of blacklistCache) {
        if (content.includes(word)) {
            const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            await executePunishment(message, "BLACKLIST", word, "即時削除 (禁止ワード)", context, null);
            return;
        }
    }

    // B. グレーリスト (AI審議)
    let grayMatch = null;
    for (const word of graylistCache) {
        if (content.includes(word)) {
            grayMatch = word;
            break;
        }
    }

    if (grayMatch) {
        const context = await fetchContext(message.channel, message.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
        
        const prompt = `
あなたは公平なモデレーターAIです。以下の[対象発言]が、文脈において「処罰すべき攻撃的発言」か判定してください。

【重要：判定ルール】
1. **メタ発言の保護**: 禁止ワードそのものについて語っている場合（例：「『死ね』は良くない」）は【SAFE】です。
2. **私情の排除**: 過去の文脈でユーザーが態度が悪かったとしても、今回の発言自体が無害なら【SAFE】としてください。
3. **UNSAFEの条件**: 明確に他者を傷つける意図で使用している場合。

【出力形式】
必ず以下のJSON形式で、日本語で応答してください。英語は一切使用しないでください。
{"verdict": "SAFE" or "UNSAFE", "reason": "日本語で短い理由を記述"}

[文脈]: ${context}
[対象発言]: ${message.content}
        `;

        const result = await callGemini(prompt);
        if (result && result.verdict === "UNSAFE") {
            await executePunishment(message, "AI_JUDGE", grayMatch, result.reason, context, result);
        } else {
            console.log(`[SAFE] ${message.author.tag}: ${grayMatch} -> ${result?.reason}`);
        }
    }
}

// 手動警告の実行
async function executeManualWarn(commandMessage, target, reason, content, context, messageId, moderatorId = null) {
    const actualModeratorId = moderatorId || commandMessage.author.id;
    const actualModerator = moderatorId ? await commandMessage.guild.members.fetch(moderatorId).catch(() => null) : commandMessage.member;
    
    const logId = Date.now().toString(36);
    
    saveModLog({
        id: logId, 
        type: 'WARN_MANUAL', 
        userId: target.id, 
        moderatorId: actualModeratorId, 
        timestamp: Date.now(), 
        reason: reason, 
        content: content, 
        contextData: context, 
        aiAnalysis: null
    });
    
    const count = addWarning(target.id, reason, actualModeratorId, logId);
    
    const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('⚠️ 手動警告')
        .setDescription(`${target} に警告が発行されました`)
        .addFields(
            { name: '警告回数', value: `${count}/${CONFIG.WARN_THRESHOLD}`, inline: true },
            { name: '理由', value: reason, inline: true },
            { name: '警告ID', value: `\`${logId}\``, inline: false }
        );
    
    if (messageId) {
        embed.addFields({ name: '対象メッセージ', value: `[メッセージへジャンプ](https://discord.com/channels/${commandMessage.guild.id}/${commandMessage.channel.id}/${messageId})`, inline: false });
    }
    
    commandMessage.channel.send({ embeds: [embed] });
    
    if (CONFIG.ALERT_CHANNEL_ID && CONFIG.ALERT_CHANNEL_ID.length > 0) {
        const alertCh = commandMessage.guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
        if (alertCh) {
            const logEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('📝 手動警告ログ')
                .addFields(
                    { name: '警告者', value: `${actualModerator?.user || actualModeratorId} (${actualModeratorId})`, inline: true },
                    { name: '対象', value: `${target} (${target.id})`, inline: true },
                    { name: '理由', value: reason, inline: false },
                    { name: '警告ID', value: `\`${logId}\``, inline: false }
                )
                .setTimestamp();
            alertCh.send({ embeds: [logEmbed] });
        }
    }
}

async function executePunishment(message, type, word, reason, context, aiResult) {
    const logId = Date.now().toString(36);
    
    const currentWarnCount = getActiveWarningCount(message.author.id);
    
    saveModLog({
        id: logId, type: type, userId: message.author.id, moderatorId: client.user.id,
        timestamp: Date.now(), reason: reason, content: message.content, 
        contextData: context, aiAnalysis: aiResult ? JSON.stringify(aiResult) : null
    });
    
    const warnCount = addWarning(message.author.id, reason, client.user.id, logId);
    
    if (currentWarnCount < 3) {
        const embed = new EmbedBuilder()
            .setColor(type === 'BLACKLIST' ? '#ff9900' : '#FF9900')
            .setTitle(type === 'BLACKLIST' ? '⚠️ 警告 (禁止ワード)' : '⚡ AI警告')
            .setDescription(`${message.author} の発言が検知されました。`)
            .addFields(
                { name: '検知ワード', value: `\`${word}\``, inline: true },
                { name: '理由', value: reason, inline: true },
                { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
            );

        if (aiResult) {
            embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
        }

        message.channel.send({ embeds: [embed] });
    } else {
        try { await message.delete(); } catch {}
        
        const embed = new EmbedBuilder()
            .setColor(type === 'BLACKLIST' ? '#ff0000' : '#FF4500')
            .setTitle(type === 'BLACKLIST' ? '🚫 警告 (自動削除)' : '⚡ AI警告 (削除)')
            .setDescription(`${message.author} の発言は削除されました。`)
            .addFields(
                { name: '検知ワード', value: `\`${word}\``, inline: true },
                { name: '理由', value: reason, inline: true },
                { name: '警告回数', value: `${warnCount}/${CONFIG.WARN_THRESHOLD}`, inline: true },
                { name: '異議申し立て', value: `\`${CONFIG.PREFIX}appeal ${logId} <理由>\``, inline: false }
            );

        if (aiResult) {
            embed.setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
        }

        message.channel.send({ embeds: [embed] });
    }

    if (warnCount >= CONFIG.WARN_THRESHOLD) {
        const alertCh = message.guild.channels.cache.get(CONFIG.ALERT_CHANNEL_ID);
        if (alertCh) alertCh.send(`🚨 **要レビュー**: ${message.author} が警告閾値に達しました。`);
    }
}

// --- 7. コマンド処理 ---
async function handleCommand(message) {
    if (!message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) {
        saveCommandLog(message.author.id, 'UNKNOWN', [], null, message.channel.id, false);
        return;
    }
    
    if (!isAdminUser(message.member)) {
        if (!checkRateLimit(message.author.id)) {
            saveCommandLog(message.author.id, 'RATE_LIMIT', [], message.guild.id, message.channel.id, false);
            return message.reply('⏱️ コマンドの実行頻度が高すぎます。しばらく待ってから再試行してください。');
        }
    }
    
    const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = isAdminUser(message.member);
    
    try {
        saveCommandLog(message.author.id, command, args, message.guild.id, message.channel.id, true);
    } catch (e) {
        console.error('Command log save error:', e);
    }

    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📜 コマンド一覧')
            .addFields({ name: '👤 ユーザー用', value: `\`${CONFIG.PREFIX}appeal <ID> <理由>\`: 異議申し立て\n\`${CONFIG.PREFIX}ticket open\`: 問い合わせ作成` });

        if (isAdmin) {
            embed.addFields({ 
                name: '👮 管理者用', 
                value: `\`${CONFIG.PREFIX}warn <@user> [理由]\`: 手動警告\n\`${CONFIG.PREFIX}unwarn <ユーザーID> [数]\`: 警告減\n\`${CONFIG.PREFIX}addword <単語> [black/gray]\`: ワード追加\n\`${CONFIG.PREFIX}removeword <単語>\`: ワード削除\n\`${CONFIG.PREFIX}listword\`: 一覧表示\n\`${CONFIG.PREFIX}timeout_user <ユーザーID>\`: タイムアウト\n\`${CONFIG.PREFIX}cmdlog [件数]\`: コマンド履歴\n\`${CONFIG.PREFIX}warnlog [ユーザーID] [件数]\`: 警告履歴\n\`${CONFIG.PREFIX}ticket close\`: チケット終了` 
            });
            embed.setColor('#ff9900');
        }
        return message.reply({ embeds: [embed] });
    }

    if (command === 'appeal') {
        const [logId, ...reasonParts] = args;
        const reason = reasonParts.join(' ');
        if (!logId || !reason) return message.reply('❌ 理由を入力してください: `!appeal <ID> <理由>`');

        const log = db.prepare('SELECT * FROM mod_logs WHERE id = ?').get(logId);
        if (!log || log.user_id !== message.author.id) return message.reply('❌ データなし');
        if (log.is_resolved) return message.reply('✅ 既に解決済みです');
        
        const APPEAL_DEADLINE_MS = 3 * 24 * 60 * 60 * 1000; 
        const timeSincePunishment = Date.now() - log.timestamp;
        if (timeSincePunishment > APPEAL_DEADLINE_MS) {
            const daysPassed = Math.floor(timeSincePunishment / (24 * 60 * 60 * 1000));
            return message.reply(`❌ 異議申し立ての期限（3日以内）を過ぎています。処罰から${daysPassed}日経過しています。`);
        }

        message.channel.sendTyping();

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
        if (!result) return message.reply('❌ AIエラー');

        const isAccepted = result.status === 'ACCEPTED';
        if (isAccepted) {
            reduceWarning(message.author.id, 1);
            db.prepare('UPDATE mod_logs SET is_resolved = 1 WHERE id = ?').run(logId);
        }

        const embed = new EmbedBuilder()
            .setColor(isAccepted ? '#00ff00' : '#ff0000')
            .setTitle(`⚖️ 審判結果: ${result.status}`)
            .setDescription(result.reason)
            .setFooter({ text: CONFIG.GEMINI_CREDIT, iconURL: CONFIG.GEMINI_ICON });
        
        message.reply({ embeds: [embed] });
        return;
    }

    if (command === 'ticket') {
        if (args[0] === 'open') {
            if (getOpenTicket(message.author.id)) return message.reply('❌ 既に開いています');
            
            if (!CONFIG.TICKET_CATEGORY_ID || CONFIG.TICKET_CATEGORY_ID.length === 0) {
                 return message.reply('❌ チケットカテゴリーIDが設定されていません。管理者に連絡してください。');
            }

            const ch = await message.guild.channels.create({
                name: `ticket-${message.author.username}`,
                type: ChannelType.GuildText,
                parent: CONFIG.TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            setOpenTicket(message.author.id, ch.id);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
            ch.send({ content: `${message.author} お問い合わせをどうぞ`, components: [row] });
            message.reply(`✅ チケット作成: ${ch}`);
        }
        else if (args[0] === 'close' && isAdmin) {
            message.channel.delete().catch(()=>{});
        }
        return;
    }

    // --- Admin Commands ---
    if (!isAdmin) return;

    if (command === 'warn') {
        const target = message.mentions.users.first();
        const reason = args.slice(1).join(' ') || '手動警告';
        if (!target) return message.reply('❌ ユーザー指定必須: `!warn <@user> [理由]`');
        
        let context = ''; 
        let content = '手動警告';
        let targetMessageId = null;
        
        if (message.reference) {
            try {
                const replyMsg = await message.channel.messages.fetch(message.reference.messageId);
                if (replyMsg.author.id !== target.id) {
                    return message.reply('❌ リプライ先のメッセージが対象ユーザーのものではありません');
                }
                content = replyMsg.content;
                targetMessageId = replyMsg.id;
                context = await fetchContext(message.channel, replyMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return message.reply('❌ メッセージの取得に失敗しました');
            }
        } else {
            try {
                const messages = await message.channel.messages.fetch({ limit: 50 });
                const targetMessages = messages.filter(m => m.author.id === target.id && !m.author.bot);
                
                if (targetMessages.size === 0) {
                    return message.reply('❌ 対象ユーザーのメッセージが見つかりませんでした');
                }
                
                const latestMsg = targetMessages.first();
                content = latestMsg.content;
                targetMessageId = latestMsg.id;
                context = await fetchContext(message.channel, latestMsg.id, CONFIG.WARN_CONTEXT_BEFORE, CONFIG.WARN_CONTEXT_AFTER);
            } catch (e) {
                return message.reply('❌ メッセージの取得に失敗しました');
            }
        }
        
        message.channel.sendTyping();
        
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentWarns = db.prepare(`
            SELECT COUNT(*) as count, MAX(timestamp) as last_warn 
            FROM mod_logs 
            WHERE user_id = ? AND type = 'WARN_MANUAL' AND moderator_id = ? AND timestamp > ?
        `).get(target.id, message.author.id, oneHourAgo);
        
        const abuseCheck = await checkWarnAbuse(message.author.id, target.id, reason, context, content);
        
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
            
            const confirmMsg = await message.reply({ embeds: [embed], components: [row] });
            
            const pendingWarnData = {
                targetId: target.id,
                moderatorId: message.author.id,
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
        
        await executeManualWarn(message, target, reason, content, context, targetMessageId);
    }

    if (command === 'unwarn') {
        const userId = args[0];
        if (!userId) return message.reply('❌ ユーザーIDを指定してください: `!unwarn <ユーザーID> [減らす数]`');
        
        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply('❌ ユーザーが見つかりません');
        
        const amount = parseInt(args[1]) || 1;
        if (amount < 1) return message.reply('❌ 減らす数は1以上である必要があります');
        
        const newCount = reduceWarning(userId, amount);
        
        const logId = Date.now().toString(36);
        saveModLog({
            id: logId, 
            type: 'UNWARN', 
            userId: userId, 
            moderatorId: message.author.id, 
            timestamp: Date.now(), 
            reason: `${amount}個の警告を削減`, 
            content: '', 
            contextData: '', 
            aiAnalysis: null
        });
        
        message.reply(`✅ ${target.user} の警告を${amount}個削減しました (現在: ${newCount})`);
    }

    if (command === 'listword') {
        const blackList = Array.from(blacklistCache).join(', ') || 'なし';
        const grayList = Array.from(graylistCache).join(', ') || 'なし';
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle('📜 禁止ワード一覧')
            .addFields({ name: '🚫 即死 (Blacklist)', value: blackList }, { name: '⚡ AI審議 (Graylist)', value: grayList });
        message.reply({ embeds: [embed] });
    }

    if (command === 'addword') {
        const word = args[0];
        const typeArg = args[1]?.toLowerCase();
        if (!word) return message.reply('❌ `!addword <単語> [black/gray]`');
        
        if (word.length > 100) return message.reply('❌ 単語が長すぎます（最大100文字）');
        
        const type = (typeArg === 'gray' || typeArg === 'g') ? 'GRAY' : 'BLACK';
        
        db.prepare('INSERT OR REPLACE INTO banned_words (word, type) VALUES (?, ?)').run(word.toLowerCase(), type);
        loadBannedWords();
        message.reply(`✅ 追加: **${word}** (${type})`);
        
        const logId = Date.now().toString(36);
        saveModLog({
            id: logId, 
            type: 'ADDWORD', 
            userId: message.author.id, 
            moderatorId: message.author.id, 
            timestamp: Date.now(), 
            reason: `単語追加: ${word} (${type})`, 
            content: word, 
            contextData: '', 
            aiAnalysis: null
        });
    }

    if (command === 'removeword') {
        const word = args[0];
        if (!word) return message.reply('❌ `!removeword <単語>`');
        
        const result = db.prepare('DELETE FROM banned_words WHERE word = ?').run(word.toLowerCase());
        if (result.changes === 0) {
            return message.reply(`❌ 単語「${word}」が見つかりませんでした`);
        }
        
        loadBannedWords();
        message.reply(`✅ 削除: ${word}`);
        
        const logId = Date.now().toString(36);
        saveModLog({
            id: logId, 
            type: 'REMOVEWORD', 
            userId: message.author.id, 
            moderatorId: message.author.id, 
            timestamp: Date.now(), 
            reason: `単語削除: ${word}`, 
            content: word, 
            contextData: '', 
            aiAnalysis: null
        });
    }

    if (command === 'timeout_user') {
        const userId = args[0];
        if (!userId) return message.reply('❌ ユーザーIDを指定してください: `!timeout_user <ユーザーID>`');
        
        const mem = await message.guild.members.fetch(userId).catch(() => null);
        if (!mem) return message.reply('❌ ユーザーが見つかりません');
        
        if (isAdminUser(mem)) {
            return message.reply('❌ 管理者をタイムアウトすることはできません');
        }
        
        try {
            await mem.timeout(CONFIG.TIMEOUT_DURATION, `手動タイムアウト by ${message.author.tag}`);
            message.reply(`🔨 ${mem.user} をタイムアウトしました (${CONFIG.TIMEOUT_DURATION / 1000 / 60}分)`);
            
            const logId = Date.now().toString(36);
            saveModLog({
                id: logId, 
                type: 'TIMEOUT', 
                userId: userId, 
                moderatorId: message.author.id, 
                timestamp: Date.now(), 
                reason: '手動タイムアウト', 
                content: '', 
                contextData: '', 
                aiAnalysis: null
            });
        } catch (e) {
            message.reply(`❌ タイムアウトの実行に失敗しました: ${e.message}`);
        }
    }
    
    if (command === 'cmdlog') {
        const limit = Math.min(parseInt(args[0]) || 10, 50); 
        const logs = db.prepare('SELECT * FROM command_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?').all(message.guild.id, limit);
        
        if (logs.length === 0) {
            return message.reply('📝 コマンド履歴がありません');
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
            const user = message.guild.members.cache.get(log.user_id);
            const date = new Date(log.timestamp).toLocaleString('ja-JP', { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
            const args = JSON.parse(log.args || '[]');
            const argsText = args.length > 0 ? args.join(' ') : '';
            const commandText = argsText ? `${CONFIG.PREFIX}${log.command} ${argsText}` : `${CONFIG.PREFIX}${log.command}`;
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
                const target = message.guild.members.cache.get(targetId);
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
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'warnlog') {
        const targetId = args[0]?.replace(/[<@!>]/g, '');
        const limit = Math.min(parseInt(args[1]) || 10, 50);
        
        let logs;
        if (targetId) {
            logs = db.prepare('SELECT * FROM mod_logs WHERE user_id = ? AND type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all(targetId, 'WARN%', limit);
        } else {
            logs = db.prepare('SELECT * FROM mod_logs WHERE type LIKE ? ORDER BY timestamp DESC LIMIT ?')
                .all('WARN%', limit);
        }
        
        if (logs.length === 0) {
            return message.reply('📝 警告履歴がありません');
        }
        
        const logText = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('ja-JP', { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const moderator = message.guild.members.cache.get(log.moderator_id);
            const target = message.guild.members.cache.get(log.user_id);
            return `\`${date}\` ${target?.user?.tag || log.user_id} ← ${moderator?.user?.tag || log.moderator_id}\n理由: ${log.reason}\nID: \`${log.id}\``;
        }).join('\n\n');
        
        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('⚠️ 警告履歴')
            .setDescription(logText.length > 4000 ? logText.substring(0, 4000) + '...' : logText)
            .setFooter({ text: targetId ? `対象: ${targetId}` : `最新${logs.length}件` });
        
        message.reply({ embeds: [embed] });
    }
}

// --- 8. インタラクション ---
client.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    
    // チケット閉鎖
    if (i.customId === 'close_ticket') {
        const uid = db.prepare('SELECT user_id FROM tickets WHERE channel_id = ?').get(i.channel.id)?.user_id;
        i.reply('Closing...');
        setTimeout(() => {
            if(uid) removeOpenTicket(uid);
            i.channel.delete().catch(()=>{});
        }, 2000);
        return;
    }
    
    // 警告確認ボタン
    if (i.customId.startsWith('warn_confirm_')) {
        if (!global.pendingWarns || !global.pendingWarns.has(i.message.id) || !i.message.author) { 
            return i.reply({ content: '❌ この警告リクエストは期限切れです', ephemeral: true });
        }
        
        const warnData = global.pendingWarns.get(i.message.id);
        
        if (!isAdminUser(i.member)) {
            return i.reply({ content: '❌ あなたにはこの操作を実行する権限がありません', ephemeral: true });
        }
        
        const target = await i.guild.members.fetch(warnData.targetId).catch(() => null);
        if (!target) {
            return i.reply({ content: '❌ 対象ユーザーが見つかりません', ephemeral: true });
        }
        
        await executeManualWarn(i.message, target.user, warnData.reason, warnData.content, warnData.context, warnData.messageId, warnData.moderatorId);
        global.pendingWarns.delete(i.message.id);
        
        await i.update({ content: '✅ 警告を実行しました', components: [], embeds: [] });
        return;
    }
    
    // 警告キャンセルボタン
    if (i.customId.startsWith('warn_cancel_')) {
        if (!global.pendingWarns || !global.pendingWarns.has(i.message.id)) {
            return i.reply({ content: '❌ この警告リクエストは期限切れです', ephemeral: true });
        }
        
        global.pendingWarns.delete(i.message.id);
        await i.update({ content: '❌ 警告がキャンセルされました', components: [], embeds: [] });
        return;
    }
});

client.login(process.env.BOT_TOKEN);
