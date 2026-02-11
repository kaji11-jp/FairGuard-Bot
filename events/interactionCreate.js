const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { handleConfirmation } = require('../services/aiConfirmation');
const { pendingWarnsCache } = require('../utils/cache');
const { isAdminUser } = require('../utils/permissions');
const { executeManualWarn } = require('../handlers/commands'); // ※後で移行が必要だが一旦既存を利用
const { removeOpenTicket } = require('../utils/tickets');
const db = require('../database');
const CONFIG = require('../config');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // --- スラッシュコマンド処理 ---
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                logger.warn(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                logger.error(`Error executing ${interaction.commandName}`);
                logger.error(error);

                const response = { content: '❌ コマンド実行中にエラーが発生しました。', ephemeral: true };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(response);
                } else {
                    await interaction.reply(response);
                }
            }
            return;
        }

        // --- セレクトメニュー処理（AIモデル選択など） ---
        if (interaction.isStringSelectMenu()) {
            // aimodelコマンドなどがコレクターを使わずにグローバルで処理する場合ここに追加
            return;
        }

        // --- ボタンインタラクション処理 ---
        if (!interaction.isButton()) return;

        try {
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
                await interaction.reply('Closing...');
                setTimeout(async () => {
                    try {
                        if (uid) removeOpenTicket(uid);
                        await interaction.channel.delete();
                    } catch (error) {
                        logger.error('チケットチャンネル削除エラー（インタラクション）', {
                            channelId: interaction.channel.id,
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }, CONFIG.TICKET_CLOSE_DELAY);
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

                    // executeManualWarnは handlers/commands.js に依存しているが、
                    // これ自体もリファクタリング対象。一旦は既存をrequireして動かすが、
                    // 最終的には Utils か Service に移動すべき。
                    // 現状は handlers/commands.js がまだ存在している前提。
                    // messageCreate も移植しないとハンドラが空になるため、
                    // executeManualWarn を独立させるのがベスト。

                    // const { executeManualWarn } = require('../handlers/commands'); 
                    // ↑ 循環参照やファイル削除に注意。

                    // とりあえず今回は handlers/commands.js にある executeManualWarn を使う想定だが、
                    // ファイルを消すならこのロジックも移動が必要。

                    // 暫定対応: もし handlers/commands.js が消えるなら、
                    // ここにロジックを持ってくるか helper に移す。
                    // 今回はまだ handlers/commands.js を完全に消していないためrequire可能と仮定するが、
                    // replace_file_content で index.js から参照を消しただけなのでファイルは残っている。

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

        } catch (error) {
            logger.error('インタラクション処理エラー', {
                error: error.message,
                stack: error.stack
            });
        }
    },
};
