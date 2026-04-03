# 🛡️ FairGuard Bot

[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue.svg)](https://discord.js.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI駆動の Discord モデレーションボット。文脈を理解する AI が公平な自動モデレーション・警告・異議申し立てを実現します。

---

## 目次

- [主な機能](#-主な機能)
- [セットアップ](#-セットアップ)
- [コマンド一覧](#-コマンド一覧)
- [トラブルシューティング](#-トラブルシューティング)
- [プロジェクト構造](#-プロジェクト構造)
- [テスト](#-テスト)
- [貢献・ライセンス](#-貢献--ライセンス)

---

## ✨ 主な機能

### 全モード共通

| 機能 | 説明 |
|------|------|
| 🤖 AIハイブリッドモデレーション | ブラックリスト即削除・グレーリストはAIが文脈判断 |
| ⚠️ 警告システム | 警告を DB に記録。閾値超過で自動処罰、30日で自動失効 |
| ⚖️ 異議申し立て | AIが元発言・文脈・理由を総合審査して公平に判定 |
| 🔍 権限濫用チェック | 手動警告時に AI が理由・頻度をチェックし不正警告を抑止 |
| 🎫 チケットシステム | プライベートチャンネルでの問い合わせ対応 |

### フルモード専用（`AI_MODE=full`）

| 機能 | 説明 |
|------|------|
| ✅ 2段階確認フロー | AI グレー判定を管理者が承認/拒否してから実行 |
| 📊 信用スコア | 警告・スパム傾向・参加日数からスコアを自動計算 |
| 💡 ソフト警告（DM） | 攻撃的なトーンをユーザーにこっそり通知 |
| 🎯 荒らしパターン検知 | 行動ログから荒らしの予兆を早期通知 |
| 📈 統計ダッシュボード | ワード・ユーザー・時間帯別の警告分析 |
| ✍️ 文章リライト | 攻撃的な文章をやわらかく言い換え |
| 🤝 衝突調停 | 言い合いに AI ファシリテーターが介入 |
| 🤖 AI チケット一次対応 | チケット作成時に AI が聞き取りを自動実施 |
| 🔍 危険ワード自動学習 | ログ頻出語から新たな禁止ワード候補を提案 |

---

## 🛠️ セットアップ

### 前提条件

- Node.js v22 以上
- Discord Bot アカウント（[Developer Portal](https://discord.com/developers/applications)）
- AI API キー（[Google AI Studio](https://aistudio.google.com/app/apikey) で無料取得可）

### 手順

**1. Discord Bot の作成**

Developer Portal で Bot を作成し、以下を有効化してください。

- Privileged Gateway Intents: `MESSAGE CONTENT INTENT`・`SERVER MEMBERS INTENT`
- OAuth2 スコープ: `bot`・`applications.commands`
- 必要な Bot 権限: `Manage Messages` / `Moderate Members` / `Manage Channels` / `Send Messages` / `Embed Links` / `Read Message History`

**2. リポジトリのクローンと依存関係のインストール**

```bash
git clone https://github.com/kaji11-jp/FairGuard-Bot.git
cd FairGuard-Bot
npm install
```

**3. 環境変数の設定**

`.env` ファイルをプロジェクトルートに作成します。

```dotenv
# ── Discord 必須 ────────────────────────────────────────
BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
DISCORD_GUILD_ID="サーバーID"
DISCORD_ADMIN_ROLE_ID="管理者ロールID"
DISCORD_ALERT_CHANNEL_ID="アラート通知チャンネルID"
DISCORD_TICKET_CATEGORY_ID="チケット作成先カテゴリID"

# ロールに関わらず管理者扱いにするユーザーID（カンマ区切り、省略可）
DISCORD_ADMIN_USER_IDS=""

# ── AI 必須 ─────────────────────────────────────────────
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# ── 暗号化キー 必須 ──────────────────────────────────────
# openssl rand -hex 32 で生成
ENCRYPTION_KEY="YOUR_32_BYTE_HEX_KEY"
# KMS 経由で取得する場合の代替（どちらか一方を設定）
# ENCRYPTION_KEY_FILE="/path/to/key"
# ENCRYPTION_KEY_COMMAND="./scripts/fetch-key.sh"

# ── オプション ───────────────────────────────────────────
AI_MODE="free"          # "free" or "full"
AI_PROVIDER="gemini"    # "gemini" / "openai" / "cerebras" / "claude"
WARN_THRESHOLD=3        # 閾値（デフォルト: 3）
WARNING_EXPIRY_DAYS=30  # 警告の有効期間（日）
```

> **Discord ID の取得方法**: Discordの「設定 → 詳細設定 → 開発者モード」を ON にすると、ユーザー・チャンネル・ロールを右クリックして「ID をコピー」できます。

**4. スラッシュコマンドの登録**

```bash
node scripts/deploy-commands.js
```

反映まで数分かかる場合があります。

**5. 起動**

```bash
node index.js
# または PM2 を使う場合
pm2 start index.js --name fairguard-bot
```

起動成功時のログ例:
```
✅ Logged in as FairGuard#1234
🛡️  System Ready: Blacklist=5, Graylist=20
```

**ログ外部転送（省略可）**

| 環境変数 | 説明 |
|----------|------|
| `LOG_WEBHOOK_URL` | 転送先エンドポイント |
| `LOG_WEBHOOK_LEVEL` | 転送する最小レベル（デフォルト: `warn`） |

ログは `logs/combined.log`・`logs/error.log` にも自動保存されます（5MB × 5世代ローテーション）。

---

## 📜 コマンド一覧

スラッシュコマンド（`/`）を推奨します。プレフィックスコマンド（`!`）は後方互換として提供しています。

### 👤 ユーザー用

| スラッシュ | プレフィックス | 説明 |
|-----------|--------------|------|
| `/appeal <log_id> <reason>` | `!appeal <ID> <理由>` | 警告への異議申し立て（3日以内） |
| `/ticket open` | `!ticket open` | サポートチケットを作成 |
| `/health` | — | Bot のヘルスチェック |

### 👮 管理者用

| スラッシュ | プレフィックス | 説明 |
|-----------|--------------|------|
| `/warn <user> [reason] [message_id]` | `!warn <@user> [理由]` | ユーザーに警告を発行 |
| `/unwarn <user_id> [amount]` | `!unwarn <ID> [数]` | 警告を削減 |
| `/addword <word> [type]` | `!addword <単語> [black/gray]` | 禁止ワードを追加 |
| `/removeword <word>` | `!removeword <単語>` | 禁止ワードを削除 |
| `/listword` | `!listword` | 禁止ワード一覧 |
| `/timeout <user_id>` | `!timeout_user <ID>` | ユーザーをタイムアウト |
| `/warnlog [user_id] [limit]` | `!warnlog [ID] [件数]` | 警告履歴 |
| `/cmdlog [limit]` | `!cmdlog [件数]` | コマンド履歴 |
| `/ticket close` | `!ticket close` | チケットを閉鎖 |
| `/health detailed` | — | 詳細ヘルスチェック |
| `/rule add/remove/list` | — | AI 憲法（サーバー独自ルール）管理 |
| `/aimodel` | — | 使用する AI モデルを変更 |
| `/analytics [days]` | — | 警告統計レポート（フルモード） |
| `/trustscore [user]` | — | 信用スコアを表示（フルモード） |
| `/tone <text>` | — | 文章をやわらかく言い換え（フルモード） |
| `/wordcandidates` | — | 危険ワード候補一覧（フルモード） |

---

## 🔧 トラブルシューティング

### Bot が起動しない

- `.env` の全必須変数が設定されているか確認
- `ENCRYPTION_KEY` が 64 文字の HEX 形式か確認（`openssl rand -hex 32` で生成）

### `Used disallowed intents` エラー

Developer Portal → Bot → **Privileged Gateway Intents** で `MESSAGE CONTENT INTENT` と `SERVER MEMBERS INTENT` を有効化してください。

### スラッシュコマンドが表示されない

1. `node scripts/deploy-commands.js` を再実行
2. 数分待ってから確認
3. Bot 招待時に `applications.commands` スコープが含まれているか確認

### AI 判定が動作しない

- `GEMINI_API_KEY` の値と AI プロバイダー設定（`AI_PROVIDER`）が一致しているか確認
- `logs/error.log` でエラー内容を確認

### Windows で `better-sqlite3` のインストールに失敗する

[Visual Studio Build Tools](https://visualstudio.microsoft.com/ja/downloads/#build-tools-for-visual-studio-2022) をインストールし「C++ によるデスクトップ開発」ワークロードを選択してから `npm install` を再実行してください。

---

## 📁 プロジェクト構造

```
FairGuard-Bot/
├── index.js                  # エントリーポイント
├── config.js                 # 環境変数・設定管理
├── database.js               # DB 初期化・暗号化ラッパー
├── commands/                 # スラッシュコマンド定義
│   ├── admin/                #   管理者コマンド
│   ├── moderation/           #   モデレーションコマンド
│   ├── tickets/              #   チケットコマンド
│   └── utility/              #   汎用コマンド
├── events/                   # Discord イベントハンドラー
│   ├── interactionCreate.js
│   ├── messageCreate.js
│   └── ready.js
├── handlers/                 # ビジネスロジック（コマンド・モデレーション）
├── services/                 # AI・警告・信用スコア等のサービス層
├── utils/                    # 共通ユーティリティ
└── scripts/
    └── deploy-commands.js    # スラッシュコマンド登録
```

---

## 🧪 テスト

```bash
npm test              # 全テスト実行
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジレポート
```

---

## 🤝 貢献 / ライセンス

PR・Issue はいつでも歓迎です → [GitHub Issues](https://github.com/kaji11-jp/FairGuard-Bot/issues)

1. フォーク → `git checkout -b feature/xxx`
2. コミット → `git push origin feature/xxx`
3. プルリクエストを作成

このプロジェクトは [MIT License](LICENSE) で公開されています。
