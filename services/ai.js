// 以前に警告ログを出したかどうかのフラグ
let nonGeminiWarningLogged = false;

// 共通システムプロンプト
const SYSTEM_INSTRUCTION = `あなたは日本語で応答するAIです。すべての応答は必ず日本語で行ってください。JSON形式で応答する場合も、理由や説明は日本語で記述してください。`;

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

// 共通レスポンス解析関数
function parseAIResponse(text) {
    if (!text) return null;

    try {
        const cleanedText = text.replace(/```json|```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleanedText);
        } catch (e) {
            // JSON形式ではない場合のフォールバック（verdictが含まれているかチェック）
            if (cleanedText.includes('SAFE') && !cleanedText.includes('UNSAFE') && !cleanedText.includes('PUNISH')) {
                parsed = { verdict: 'SAFE', reason: 'AI応答の解析に失敗しましたが、SAFEと判断されました' };
            } else if (cleanedText.includes('UNSAFE') || cleanedText.includes('PUNISH')) {
                parsed = { verdict: cleanedText.includes('PUNISH') ? 'PUNISH' : 'UNSAFE', reason: 'AI応答の解析に失敗しましたが、不適切と判断されました' };
            } else {
                throw e; // 解析不能な場合は再試行へ
            }
        }
        return parsed;
    } catch (parseError) {
        throw new Error(`JSON解析エラー: ${parseError.message}`);
    }
}

// Gemini APIハンドラー
async function handlerGemini(prompt, attempt, controller) {
    const fullPrompt = `${SYSTEM_INSTRUCTION}\n\n以下の入力を処理してください:\n<input>\n${prompt}\n</input>`;

    // 動的設定の取得
    const model = configManager.get('GEMINI_MODEL');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const apiKey = configManager.get('GEMINI_API_KEY');

    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
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

    if (!response.ok) return { ok: false, status: response.status, response };

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return { ok: true, text };
}

// OpenAI互換 APIハンドラー (OpenAI, Cerebras)
async function handlerOpenAICompatible(prompt, attempt, controller, provider) {
    let apiUrl, apiKey, model;

    if (provider === 'cerebras') {
        apiUrl = configManager.get('CEREBRAS_API_URL');
        apiKey = configManager.get('CEREBRAS_API_KEY');
        model = configManager.get('CEREBRAS_MODEL');
    } else {
        apiUrl = configManager.get('OPENAI_API_URL');
        apiKey = configManager.get('OPENAI_API_KEY');
        model = configManager.get('OPENAI_MODEL');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" } // OpenAIなどJSONモード対応の場合
        }),
        signal: controller.signal
    });

    if (!response.ok) return { ok: false, status: response.status, response };

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    return { ok: true, text };
}

// Claude (Anthropic) APIハンドラー
async function handlerAnthropic(prompt, attempt, controller) {
    const apiUrl = configManager.get('ANTHROPIC_API_URL');
    const apiKey = configManager.get('ANTHROPIC_API_KEY');
    const model = configManager.get('ANTHROPIC_MODEL');

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 1024,
            system: SYSTEM_INSTRUCTION,
            messages: [
                { role: "user", content: prompt }
            ],
            temperature: 0.3
        }),
        signal: controller.signal
    });

    if (!response.ok) return { ok: false, status: response.status, response };

    const data = await response.json();
    const text = data.content?.[0]?.text;
    return { ok: true, text };
}

// 汎用AI呼び出し関数（リトライ機構付き）
async function callAIWithRetry(prompt, maxRetries = 3, timeout = 30000) {
    const provider = configManager.get('AI_PROVIDER');

    // 非推奨プロバイダーの警告ログ（初回のみ）
    if (provider !== 'gemini' && !nonGeminiWarningLogged) {
        logger.warn(`⚠️ 現在のAIプロバイダーは '${provider}' です。これは実験的な機能であり、予期せぬ動作をする可能性があります。推奨は 'gemini' です。`);
        nonGeminiWarningLogged = true;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            let result;

            if (provider === 'gemini') {
                result = await handlerGemini(prompt, attempt, controller);
            } else if (provider === 'openai' || provider === 'cerebras') {
                result = await handlerOpenAICompatible(prompt, attempt, controller, provider);
            } else if (provider === 'claude') {
                result = await handlerAnthropic(prompt, attempt, controller);
            } else {
                clearTimeout(timeoutId);
                logger.error(`不明なAIプロバイダー設定: ${provider}`);
                return null;
            }

            clearTimeout(timeoutId);

            if (!result.ok) {
                const errorData = await result.response.json().catch(() => ({}));

                // リトライすべきエラー判定
                const retryableStatuses = [429, 500, 502, 503, 504];
                if (retryableStatuses.includes(result.status)) {
                    const backoffDelay = Math.pow(2, attempt) * 1000;
                    logger.warn(`${provider} API 一時的エラー (${result.status})。${backoffDelay}ms後にリトライ`, {
                        attempt: attempt + 1,
                        maxRetries,
                        status: result.status
                    });

                    if (attempt < maxRetries - 1) {
                        await sleep(backoffDelay);
                        continue;
                    }
                }

                logger.error(`${provider} API HTTPエラー`, {
                    status: result.status,
                    errorData,
                    attempt: attempt + 1
                });
                return null;
            }

            const text = result.text;
            if (!text) {
                logger.warn(`${provider} API: レスポンスにテキストがありません`, { attempt: attempt + 1 });
                if (attempt < maxRetries - 1) {
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                return null;
            }

            try {
                const parsed = parseAIResponse(text);
                logger.debug(`${provider} API呼び出し成功`, { attempt: attempt + 1 });
                return parsed;
            } catch (parseError) {
                logger.error(`${provider} API: JSON解析エラー`, {
                    text: text.substring(0, 200),
                    error: parseError.message,
                    attempt: attempt + 1
                });

                if (attempt < maxRetries - 1) {
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                return null;
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                logger.warn(`${provider} API: タイムアウト`, { timeout, attempt: attempt + 1 });
            } else {
                logger.error(`${provider} API呼び出しエラー`, {
                    error: error.message,
                    stack: error.stack,
                    attempt: attempt + 1
                });
            }

            if (attempt < maxRetries - 1) {
                const backoffDelay = Math.pow(2, attempt) * 1000;
                await sleep(backoffDelay);
                continue;
            }
            return null;
        }
    }

    logger.error(`${provider} API: 最大リトライ回数に達しました`, { maxRetries });
    return null;
}

// 後方互換性のため、callGeminiも残すが、内部ではcallAIWithRetryを呼ぶ
// 名前はcallGeminiだが、設定によってはOpenAI等を呼ぶことになる
async function callGemini(prompt) {
    return await callAIWithRetry(prompt);
}

// エイリアス（新しいコードはこちらを使うことを推奨）
async function callAI(prompt) {
    return await callAIWithRetry(prompt);
}

// 手動警告のAbuse判定
async function checkWarnAbuse(moderatorId, targetId, reason, context, content) {
    const db = require('../database');
    const CONFIG = require('../config');
    const configManager = require('./configManager');
    const logger = require('../utils/logger');
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
    callAI,
    callAIWithRetry,
    checkWarnAbuse
};

