const CONFIG = require('../config');
const logger = require('../utils/logger');

// スリープ関数（リトライ用）
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 文脈取得（前後指定数のメッセージを取得）
async function fetchContext(channel, messageId, beforeLimit = 10, afterLimit = 10) {
    try {
        const contextMessages = [];
        
        // メッセージ取得を並列化してパフォーマンスを向上
        const [beforeMessagesResult, targetMsgResult, afterMessagesResult] = await Promise.allSettled([
            channel.messages.fetch({ limit: beforeLimit, before: messageId }),
            channel.messages.fetch(messageId).catch(error => {
                logger.warn('対象メッセージの取得に失敗', { messageId, error: error.message });
                return null;
            }),
            channel.messages.fetch({ limit: afterLimit, after: messageId })
        ]);
        
        // beforeMessagesの処理
        if (beforeMessagesResult.status === 'fulfilled') {
            beforeMessagesResult.value.forEach(m => contextMessages.push({ msg: m, order: 'before' }));
        } else {
            logger.warn('前メッセージの取得に失敗', { messageId, error: beforeMessagesResult.reason?.message });
        }
        
        // targetMsgの処理
        if (targetMsgResult.status === 'fulfilled' && targetMsgResult.value) {
            contextMessages.push({ msg: targetMsgResult.value, order: 'target' });
        }
        
        // afterMessagesの処理
        if (afterMessagesResult.status === 'fulfilled') {
            afterMessagesResult.value.forEach(m => contextMessages.push({ msg: m, order: 'after' }));
        } else {
            logger.warn('後メッセージの取得に失敗', { messageId, error: afterMessagesResult.reason?.message });
        }
        
        contextMessages.sort((a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp);
        
        return contextMessages.map(({ msg, order }) => {
            const marker = order === 'target' ? '【対象】' : '';
            return `${marker}[${msg.author.tag}]: ${msg.content}`;
        }).join('\n');
    } catch (error) {
        logger.error('文脈取得エラー', { messageId, error: error.message, stack: error.stack });
        return "文脈取得失敗";
    }
}

// Gemini API呼び出し（リトライ機構付き）
async function callGeminiWithRetry(prompt, maxRetries = 3, timeout = 30000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const systemInstruction = `あなたは日本語で応答するAIです。すべての応答は必ず日本語で行ってください。JSON形式で応答する場合も、理由や説明は日本語で記述してください。`;
            const fullPrompt = `${systemInstruction}\n\n${prompt}`;
            
            // タイムアウト付きfetch
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
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
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                // レート制限エラー（429）の場合はリトライ
                if (response.status === 429) {
                    const backoffDelay = Math.pow(2, attempt) * 1000; // 指数バックオフ
                    logger.warn(`Gemini API レート制限エラー。${backoffDelay}ms後にリトライ`, { 
                        attempt: attempt + 1, 
                        maxRetries,
                        status: response.status 
                    });
                    
                    if (attempt < maxRetries - 1) {
                        await sleep(backoffDelay);
                        continue;
                    }
                }
                
                // その他のHTTPエラー
                logger.error('Gemini API HTTPエラー', { 
                    status: response.status, 
                    errorData,
                    attempt: attempt + 1 
                });
                return null;
            }
            
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!text) {
                logger.warn('Gemini API: レスポンスにテキストがありません', { 
                    data,
                    attempt: attempt + 1 
                });
                
                // 最後の試行でなければリトライ
                if (attempt < maxRetries - 1) {
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                return null;
            }
            
            try {
                const cleanedText = text.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(cleanedText);
                logger.debug('Gemini API呼び出し成功', { attempt: attempt + 1 });
                return parsed;
            } catch (parseError) {
                logger.error('Gemini API: JSON解析エラー', { 
                    text: cleanedText.substring(0, 200),
                    error: parseError.message,
                    attempt: attempt + 1 
                });
                
                // 最後の試行でなければリトライ
                if (attempt < maxRetries - 1) {
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                return null;
            }
        } catch (error) {
            // ネットワークエラーやタイムアウト
            if (error.name === 'AbortError') {
                logger.warn('Gemini API: タイムアウト', { 
                    timeout,
                    attempt: attempt + 1 
                });
            } else {
                logger.error('Gemini API呼び出しエラー', { 
                    error: error.message,
                    stack: error.stack,
                    attempt: attempt + 1 
                });
            }
            
            // 最後の試行でなければリトライ
            if (attempt < maxRetries - 1) {
                const backoffDelay = Math.pow(2, attempt) * 1000;
                await sleep(backoffDelay);
                continue;
            }
            
            return null;
        }
    }
    
    logger.error('Gemini API: 最大リトライ回数に達しました', { maxRetries });
    return null;
}

// 後方互換性のため、callGeminiも残す
async function callGemini(prompt) {
    return await callGeminiWithRetry(prompt);
}

// 手動警告のAbuse判定
async function checkWarnAbuse(moderatorId, targetId, reason, context, content) {
    const db = require('../database');
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

module.exports = {
    fetchContext,
    callGemini,
    callGeminiWithRetry,
    checkWarnAbuse
};

