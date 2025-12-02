# 🛡️ FairGuard Bot

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue.svg)](https://discord.js.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**AI駆動の高度なDiscordモデレーションボット**

Google Gemini APIを活用した、公平で洗練されたコミュニティ運営を実現するDiscord Botです。文脈を理解するAIによる自動モデレーション、警告システム、異議申し立て機能など、本格的なコミュニティ管理に必要な機能を提供します。

---

## 📋 目次

- [主な機能](#-主な機能)
- [セットアップ](#-セットアップ)
- [コマンド一覧](#-コマンド一覧)
- [使用方法](#-使用方法)
- [トラブルシューティング](#-トラブルシューティング)
- [FAQ](#-よくある質問)
- [プロジェクト構造](#-プロジェクト構造)
- [貢献](#-貢献)
- [ライセンス](#-ライセンス)

---

## ✨ 主な機能

### 基本機能（無料モード・フルモード共通）

#### 1. 🤖 AIハイブリッドモデレーション

- **ブラックリスト**: 設定された禁止ワードに一致した場合、即座に削除・警告を発行
- **グレーリスト (AI審議)**: 潜在的な攻撃的ワード（「死ね」など）に対して、**メッセージの文脈**をAIが判断し、**ハラスメント意図がある場合のみ**警告を発行
- **連投・長文投稿検出**: 短期間のスパム行為や過度な長文投稿をAIが検知し、自動で警告を発行

#### 2. ⚠️ 警告システムと自動処罰

- 警告はデータベースに永続的に記録され、自動的に**30日で失効**
- 警告が設定回数（デフォルト: 3回）を超えると、自動でメッセージ削除などの処罰が実行
- 警告履歴は完全に追跡可能

#### 3. ⚖️ 警告の異議申し立てシステム

- ユーザーは Bot から受けた警告に対し、`/appeal` または `!appeal` コマンドで**異議申し立て**が可能
- AIが、元の警告理由、ユーザーの言い分、そして**発言の文脈**を総合的に判断し、公平な「審判」を下します
- 異議申し立ては処罰から3日以内に提出可能

#### 4. 🔍 モデレーター権限濫用チェック

- 管理者が手動で警告 (`/warn` または `!warn`) を発行する際、AIが警告の理由や頻度をチェック
- **不適切な警告**である可能性を通知し、第三者的な視点を提供
- 感情的な警告を防止

#### 5. 🎫 サポートチケットシステム

- `/ticket open` または `!ticket open` で管理者にプライベートにお問い合わせできるチケットチャンネルを作成
- プライベートチャンネルで安全に相談可能

#### 6. 💬 モダンなコマンドシステム

- スラッシュコマンド（`/command`）とプレフィックスコマンド（`!command`）の両方をサポート
- スラッシュコマンドは引数の自動補完とバリデーション機能を提供

### フルモード専用機能（AI_MODE="full"）

フルモードでは、より高度なAI機能が利用可能になります。**注意**: フルモードはAPI使用量が増加します。

#### 7. ✅ 確認つきAI警告（2段階フロー）

- AIがグレー判定した場合、即警告ではなく管理者に確認を求める2段階フロー
- 管理者が「承認/拒否」ボタンで判断可能
- 誤爆を完全に防止

#### 8. 📊 ユーザー信用スコアシステム

- 行動ログをもとに、ユーザーの信用スコア（0〜100）を自動計算
- 警告数、スパム傾向、参加日数などから算出
- `/trustscore` コマンドで確認可能
- 低信用スコアユーザーには厳格な審査を適用

#### 9. 💡 AIトーン推定（ソフト警告）

- 攻撃的な言い方をしたユーザーに対して、本人のみにDMで通知
- 警告ほど重くなく、「気づき」を促すソフト警告
- 公開されないため、ユーザーのプライバシーを保護

#### 10. 🎯 自動荒らしパターン検知

- 過去のログをもとにAIが荒らしの行動パターンを学習
- 特定パターンが見えた時に管理者に早期通知
- プロアクティブな対策が可能

#### 11. 📈 警告相関分析ダッシュボード

- `/analytics` コマンドで統計レポートを表示
- どのワードが多い、どのユーザーのトラブルが多い、どの時間帯に荒れやすいなどを可視化
- データドリブンなコミュニティ運営を実現

#### 12. ✍️ AI文章リライトコマンド

- `/tone <text>` で攻撃的すぎる文章を「やんわり言い換えて返す」機能
- 管理者が注意するとき、トラブル回避したいときなどに活用

#### 13. 🤝 AI荒らし誘惑防止システム

- 攻撃的な言い合いが始まるとAIが介入
- 「相互に誤解がある可能性があります。落ち着いて」と空気を柔らかくするメッセージを投稿
- AIファシリテーターとして機能

#### 14. 🤖 AIチケット応答（一次対応）

- チケット作成時にAIが「まず聞くべき内容」を聞き取り
- モデレーターは整理済みの情報だけ確認すればOK
- 管理側の負担を大幅に軽減

#### 15. 🔍 危険ワード自動学習

- ログに一定頻度で出る未知語について、AIが「これは危険語か？」と判断
- `/wordcandidates` コマンドで候補を確認可能
- ブラックリストの進化が自動化

---

## 🛠️ セットアップ

### 前提条件

- **Node.js v18以上**が必要です
- **Discord Bot アカウント**が必要です
- **Google Gemini API キー**が必要です

### ステップ1: Discord Botの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリックしてアプリケーションを作成
3. 「Bot」タブに移動し、「Add Bot」をクリック
4. Botのトークンをコピー（後で使用します）
5. 「OAuth2」→「URL Generator」で以下の権限を選択：
   - `bot`
   - `applications.commands`
   - 必要な権限：
     - `Manage Messages`
     - `Moderate Members`
     - `Manage Channels`
     - `View Channels`
     - `Send Messages`
     - `Embed Links`
     - `Read Message History`
6. 生成されたURLでBotをサーバーに招待

### ステップ2: Google Gemini API キーの取得

Google Gemini APIキーは、このBotのAI機能を動作させるために必要です。**無料で取得できます**。

#### 2-1. Googleアカウントでログイン

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. Googleアカウントでログインします（GmailアカウントがあればOK）

**注意**: 初回アクセスの場合、利用規約への同意が求められる場合があります。

#### 2-2. APIキーの作成

1. ページにアクセスすると、以下のような画面が表示されます：
   - 「Get API key」または「API キーを取得」というボタンがあるはずです
   - もしくは、左側のメニューから「Get API key」を選択

2. 「Create API key」または「API キーを作成」をクリック

3. プロジェクトの選択画面が表示されます：
   - **初めての場合**: 「Create API key in new project」を選択
   - **既存のプロジェクトがある場合**: ドロップダウンからプロジェクトを選択して「Create API key in existing project」を選択

4. APIキーが生成されます：
   - **重要**: この画面で表示されるAPIキーは**この時だけ**表示されます
   - 必ずコピーして安全な場所に保存してください
   - 例: `AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567`

#### 2-3. APIキーの確認と管理

1. 作成したAPIキーは、[Google Cloud Console](https://console.cloud.google.com/apis/credentials) で確認・管理できます
2. 必要に応じて、APIキーの制限を設定できます（推奨）：
   - 「API キーの制限」から「API の制限」を選択
   - 「Generative Language API」のみを許可することを推奨

#### 2-4. 無料枠について

Google Gemini APIには**無料枠**があります：

- **無料枠**: 1分あたり15リクエスト、1日あたり1,500リクエスト
- 小〜中規模のサーバーであれば、無料枠で十分運用可能です
- 使用量は [Google Cloud Console](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas) で確認できます

#### 2-5. よくある質問

**Q: APIキーは安全ですか？**
- APIキーは他人に知られないようにしてください
- `.env` ファイルに保存し、GitHubなどにアップロードしないでください
- もし漏洩した場合は、Google Cloud Consoleからすぐに削除・再作成してください

**Q: 無料枠を超えたらどうなりますか？**
- 無料枠を超えると、APIリクエストがエラーになります
- 有料プランにアップグレードするか、使用量を減らす必要があります

**Q: APIキーが表示されない/エラーが出る**
- ブラウザのキャッシュをクリアしてみてください
- 別のブラウザで試してみてください
- Googleアカウントの認証状態を確認してください

### ステップ3: リポジトリのクローン

```bash
git clone https://github.com/kaji11-jp/FairGuard-Bot.git
cd FairGuard-Bot
```

### ステップ4: 依存関係のインストール

```bash
npm install
```

または個別にインストールする場合：

```bash
npm install discord.js better-sqlite3 dotenv winston
```

### ステップ5: 環境変数の設定

プロジェクトのルートディレクトリに `.env` ファイルを作成し、以下の変数を設定してください。

```dotenv
# === Discord Bot設定（必須） ===
BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
DISCORD_GUILD_ID="あなたのサーバーのID"
DISCORD_ADMIN_ROLE_ID="管理者が持っているロールのID"
DISCORD_ALERT_CHANNEL_ID="警告・ログを通知するチャンネルのID"
DISCORD_TICKET_CATEGORY_ID="チケットチャンネルを作成するカテゴリのID"

# === オプション設定 ===
# ロールに関わらず管理者権限を持つユーザーIDをカンマ区切りで指定
# 例: DISCORD_ADMIN_USER_IDS="123456789012345678,987654321098765432"
DISCORD_ADMIN_USER_IDS=""

# === AI設定（必須） ===
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# === AIモード設定（オプション） ===
# "free": 無料枠向けの基本機能のみ（デフォルト）
# "full": 全機能有効（AI API使用量が増加します）
AI_MODE="free"
```

#### 環境変数の取得方法

##### Discord関連のID取得方法

DiscordのIDを取得するには、**開発者モード**を有効化する必要があります：

1. Discordを開く
2. 設定（⚙️）→ 詳細設定 → 「開発者モード」をONにする
3. これで、ユーザー、チャンネル、ロールなどを右クリックして「IDをコピー」ができるようになります

**各IDの取得方法**:

- **BOT_TOKEN**: 
  - [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
  - 作成したアプリケーションを選択
  - 左メニューの「Bot」をクリック
  - 「Token」セクションの「Reset Token」または「Copy」をクリック
  - **重要**: トークンは他人に知られないようにしてください

- **DISCORD_GUILD_ID**（サーバーID）:
  - Discordでサーバーを開く
  - サーバー名を右クリック → 「IDをコピー」
  - または、サーバー設定 → ウィジェット → サーバーIDを有効化してコピー

- **DISCORD_ADMIN_ROLE_ID**（管理者ロールID）:
  - サーバー設定 → ロール
  - 管理者ロールを右クリック → 「IDをコピー」
  - または、ロール名を右クリック → 「IDをコピー」

- **DISCORD_ALERT_CHANNEL_ID**（アラートチャンネルID）:
  - 警告やログを送信したいチャンネルを右クリック
  - 「IDをコピー」を選択

- **DISCORD_TICKET_CATEGORY_ID**（チケットカテゴリID）:
  - チケットチャンネルを作成するカテゴリを右クリック
  - 「IDをコピー」を選択
  - カテゴリがない場合は、新しく作成してください

##### Google Gemini APIキーの設定

- **GEMINI_API_KEY**: 
  - 上記の「ステップ2: Google Gemini API キーの取得」を参照
  - 取得したAPIキーをそのまま貼り付けます
  - 例: `GEMINI_API_KEY="AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567"`

**注意事項**:
- `.env` ファイルは `.gitignore` に含まれているため、GitHubにアップロードされません
- すべての値は**ダブルクォート（`"`）で囲む**必要があります
- 値の前後に余分なスペースを入れないでください

### ステップ6: スラッシュコマンドの登録

Botを起動する前に、スラッシュコマンドをDiscordに登録する必要があります。

```bash
node scripts/deploy-commands.js
```

**注意**: 
- コマンドの変更や追加を行った場合は、このスクリプトを再実行してください
- コマンドの反映には数分かかる場合があります

### ステップ7: Botの起動

```bash
node index.js
```

正常に起動すると、以下のメッセージが表示されます：

```
✅ Logged in as YourBot#1234
🛡️  System Ready: Blacklist=X, Graylist=Y
```

### ステップ8: プロセス管理（推奨）

本番環境では、PM2などのプロセス管理ツールを使用することを強く推奨します。

```bash
# PM2のインストール
npm install -g pm2

# Botの起動
pm2 start index.js --name fairguard-bot

# 自動起動設定
pm2 startup
pm2 save

# ログ確認
pm2 logs fairguard-bot

# 停止
pm2 stop fairguard-bot
```

---

## 📜 コマンド一覧

このBotは**スラッシュコマンド**（`/command`）と**プレフィックスコマンド**（`!command`）の両方をサポートしています。

### スラッシュコマンド（推奨）

Discordのネイティブ機能を使用したモダンなコマンドシステムです。引数の自動補完とバリデーション機能を提供します。

#### 👤 ユーザー用コマンド

| コマンド | 説明 | 例 |
|---------|------|-----|
| `/help` | コマンド一覧を表示 | `/help` |
| `/appeal <log_id> <reason>` | 警告に対する異議申し立て | `/appeal abc123 誤検知です` |
| `/ticket open` | サポートチケットを作成 | `/ticket open` |
| `/health [detailed]` | Botのヘルスチェック情報を表示 | `/health` または `/health detailed` |

#### 👮 管理者用コマンド

| コマンド | 説明 | 例 |
|---------|------|-----|
| `/warn <user> [reason] [message_id]` | ユーザーに警告を発行 | `/warn @user スパム行為` |
| `/unwarn <user_id> [amount]` | ユーザーの警告を削減 | `/unwarn 123456789012345678 1` |
| `/addword <word> [type]` | 禁止ワードを追加 | `/addword 悪質 black` |
| `/removeword <word>` | 禁止ワードを削除 | `/removeword 悪質` |
| `/listword` | 禁止ワード一覧を表示 | `/listword` |
| `/timeout <user_id>` | ユーザーをタイムアウト | `/timeout 123456789012345678` |
| `/cmdlog [limit]` | コマンド履歴を表示 | `/cmdlog 20` |
| `/warnlog [user_id] [limit]` | 警告履歴を表示 | `/warnlog 123456789012345678` |
| `/ticket close` | チケットを閉鎖 | `/ticket close` |
| `/health [detailed]` | Botのヘルスチェック情報を表示 | `/health` または `/health detailed` |
| `/analytics [days]` | 警告相関分析レポート | `/analytics 30` |
| `/trustscore [user]` | ユーザーの信用スコアを表示 | `/trustscore @user` |
| `/tone <text>` | 文章をやわらかく言い換え（フルモード専用） | `/tone お前はバカだ` |
| `/wordcandidates` | 危険ワード候補を表示（フルモード専用） | `/wordcandidates` |

### プレフィックスコマンド（従来方式）

従来の `!` プレフィックスコマンドも引き続き利用可能です。

- `!help` - コマンド一覧を表示
- `!appeal <ID> <理由>` - 異議申し立て
- `!ticket open` - チケット作成
- `!warn <@user> [理由]` - 手動警告（管理者専用）
- `!unwarn <ユーザーID> [数]` - 警告削減（管理者専用）
- `!addword <単語> [black/gray]` - ワード追加（管理者専用）
- `!removeword <単語>` - ワード削除（管理者専用）
- `!listword` - 一覧表示（管理者専用）
- `!timeout_user <ユーザーID>` - タイムアウト（管理者専用）
- `!cmdlog [件数]` - コマンド履歴（管理者専用）
- `!warnlog [ユーザーID] [件数]` - 警告履歴（管理者専用）
- `!ticket close` - チケット終了（管理者専用）

---

## 💡 使用方法

### 基本的な使い方

1. **禁止ワードの設定**
   ```
   /addword 悪質 black
   /addword うざい gray
   ```

2. **警告の発行**
   ```
   /warn @user スパム行為
   ```

3. **警告履歴の確認**
   ```
   /warnlog @user
   ```

4. **統計レポートの確認（フルモード）**
   ```
   /analytics 30
   ```

### 異議申し立ての流れ

1. ユーザーが警告を受ける
2. 警告メッセージに表示されたログIDを確認
3. `/appeal <log_id> <理由>` で異議申し立て
4. AIが審査し、結果を通知

### チケットシステムの使い方

1. ユーザーが `/ticket open` を実行
2. プライベートチャンネルが作成される
3. ユーザーが問い合わせ内容を記入
4. 管理者が対応
5. `/ticket close` でチケットを閉鎖

---

## 🔧 トラブルシューティング

### Botが起動しない

**問題**: `❌ .env に必要な設定が不足しています`

**解決策**:
- `.env` ファイルが正しく作成されているか確認
- すべての必須環境変数が設定されているか確認
- 値に余分なスペースや引用符がないか確認

### スラッシュコマンドが表示されない

**問題**: スラッシュコマンドがDiscordに表示されない

**解決策**:
1. `node scripts/deploy-commands.js` を再実行
2. 数分待ってから再確認
3. Botに `applications.commands` スコープが付与されているか確認
4. Botをサーバーから削除して再招待

### AI判定が動作しない

**問題**: AI判定が実行されない、またはエラーが発生する

**解決策**:
- `GEMINI_API_KEY` が正しく設定されているか確認
- APIキーの有効期限を確認
- API使用量の上限に達していないか確認
- コンソールのエラーメッセージを確認

### データベースエラー

**問題**: データベース関連のエラーが発生する

**解決策**:
- `bot_data.sqlite` ファイルの権限を確認
- データベースファイルが破損している場合は削除して再作成（**警告**: すべてのデータが失われます）

### Windowsで `better-sqlite3` のインストールに失敗する

**問題**: `npm install` 時に `better-sqlite3` のビルドエラーが発生する（Pythonが見つからない、node-gypエラーなど）

**解決策**:

#### 方法1: Visual Studio Build Tools をインストール（推奨）

1. [Visual Studio Build Tools](https://visualstudio.microsoft.com/ja/downloads/#build-tools-for-visual-studio-2022) をダウンロード
2. インストーラーを実行し、「C++によるデスクトップ開発」ワークロードを選択してインストール
3. インストール後、PowerShellを再起動
4. 再度 `npm install` を実行

#### 方法2: Python をインストール（方法1がうまくいかない場合）

1. [Python公式サイト](https://www.python.org/downloads/) から最新のPython 3.xをダウンロード
2. インストール時に「Add Python to PATH」にチェックを入れる
3. インストール後、PowerShellを再起動
4. 再度 `npm install` を実行

#### 方法3: プリビルド済みバイナリを使用

```bash
npm install --build-from-source=false better-sqlite3
```

または、環境変数を設定：

```powershell
$env:npm_config_build_from_source="false"
npm install better-sqlite3
```

**注意**: 方法3は、Node.jsのバージョンとアーキテクチャに合ったプリビルド済みバイナリが存在する場合のみ動作します。

### 警告が発行されない

**問題**: 禁止ワードを発言しても警告が発行されない

**解決策**:
- Botがサーバーに正しく参加しているか確認
- Botに `Manage Messages` 権限があるか確認
- 禁止ワードが正しく登録されているか `/listword` で確認
- 管理者ユーザーは警告対象外であることを確認

---

## ❓ よくある質問

### Q: 無料モードとフルモードの違いは？

**A**: 
- **無料モード（free）**: 基本的なAIモデレーション機能のみ。無料枠で運用可能
- **フルモード（full）**: 全15機能が利用可能。API使用量が増加しますが、より高度な機能が使えます

### Q: API使用量はどのくらい？

**A**: 
- 無料モード: 1日あたり約100-500リクエスト（サーバー規模による）
- フルモード: 1日あたり約500-2000リクエスト（機能使用状況による）

Google Gemini APIの無料枠は十分に広いため、小〜中規模のサーバーであれば無料枠で運用可能です。

### Q: 警告はどのくらいの期間保存されますか？

**A**: 警告は30日間有効です。30日経過後は自動的に失効し、警告カウントから除外されます。

### Q: 複数のサーバーで使用できますか？

**A**: 現在の実装では、1つのBotインスタンスで1つのサーバー（Guild）のみをサポートしています。複数サーバーで使用する場合は、各サーバーごとにBotインスタンスを起動する必要があります。

### Q: カスタマイズは可能ですか？

**A**: はい。このプロジェクトはオープンソースです。`config.js` で設定を変更したり、コードを直接編集してカスタマイズできます。

### Q: パフォーマンスはどうですか？

**A**: 
- メッセージ処理: 通常 < 100ms
- AI判定: 1-3秒（Gemini APIの応答時間による）
- データベース操作: < 10ms

### Q: セキュリティは大丈夫ですか？

**A**: 
- すべてのデータはローカルのSQLiteデータベースに保存されます
- APIキーは環境変数で管理され、コードに含まれません
- 管理者権限は厳格にチェックされます

---

## 📁 プロジェクト構造

このプロジェクトはモジュール化されており、保守性と拡張性を重視した設計になっています。

```
FairGuard-Bot/
├── index.js              # メインファイル（Botの起動とイベント処理）
├── config.js             # 設定と環境変数チェック
├── database.js           # データベース初期化
├── commands/             # スラッシュコマンド定義
│   └── commands.js
├── handlers/             # イベントハンドラー
│   ├── commands.js       # プレフィックスコマンド処理
│   ├── slashCommands.js  # スラッシュコマンド処理
│   ├── interactions.js   # ボタンインタラクション処理
│   └── moderation.js     # モデレーション処理
├── services/             # ビジネスロジック
│   ├── ai.js            # Gemini API、AI判定
│   ├── warnings.js      # 警告管理
│   ├── trustScore.js    # 信用スコア
│   ├── aiConfirmation.js # AI確認フロー
│   ├── toneAnalysis.js  # トーン分析
│   ├── trollDetection.js # 荒らし検知
│   ├── analytics.js     # 分析ダッシュボード
│   ├── textRewriter.js  # 文章リライト
│   ├── conflictMediation.js # 衝突調停
│   ├── ticketAI.js      # AIチケット応答
│   └── wordLearning.js  # 危険ワード学習
├── utils/               # ユーティリティ関数
│   ├── bannedWords.js   # 禁止ワード管理
│   ├── logs.js          # ログ保存
│   ├── permissions.js   # 権限チェック
│   ├── rateLimit.js     # レート制限
│   └── tickets.js       # チケット管理
└── scripts/             # ユーティリティスクリプト
    └── deploy-commands.js # スラッシュコマンド登録
```

---

## 🤝 貢献

このプロジェクトへの貢献を歓迎します！

### 貢献方法

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m 'Add some AmazingFeature'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. プルリクエストを開く

### バグ報告

バグを発見した場合は、[Issues](https://github.com/kaji11-jp/FairGuard-Bot/issues) で報告してください。

### 機能要望

新機能の要望も [Issues](https://github.com/kaji11-jp/FairGuard-Bot/issues) で受け付けています。

---

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。


---

## 🧪 テスト

このプロジェクトにはJestを使用したテストスイートが含まれています。

### テストの実行

```bash
# すべてのテストを実行
npm test

# ウォッチモードで実行
npm run test:watch

# カバレッジレポートを生成
npm run test:coverage
```

### テストカバレッジ

テストは以下の機能をカバーしています：

- 警告システム（追加、削減、カウント取得）
- トランザクション管理
- エラーハンドリング

---

## 📞 サポート

問題が発生した場合や質問がある場合は、以下からお問い合わせください：

- [GitHub Issues](https://github.com/kaji11-jp/FairGuard-Bot/issues)


---

**Made with ❤️ for fair community moderation**
