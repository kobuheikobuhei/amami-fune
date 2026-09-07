# 奄美大島 船舶動静ブログ

奄美大島に関係する定期航路の欠航・臨時便・ダイヤ変更を、各社の公式発表から自動収集して
Blogger に掲載するシステム。仕様は [SPEC.md](SPEC.md) を参照。

## 動かし方

```bash
npm install

# 取得と判定だけ行う。投稿も状態の書き込みもしない
npm run watch:dry

# 生成される記事の中身を確認する
npm run preview

# 便ごとの解析結果を確認する
npm run check:parse

# 状態は記録するが投稿はしない（台帳の動作確認用）
npm run watch:local

# 本番
npm run watch
```

## この環境での注意

Windows の PowerShell は既定でスクリプトの実行を禁止しているため、`npm run ○○` が
「スクリプトの実行が無効になっているため」というエラーで止まる。
設定を変える必要はなく、`node` で直接呼べば動く。

| 使いたいもの | 実際に打つコマンド |
|---|---|
| `npm run watch:dry` | `node src/main.js --dry-run --force` |
| `npm run watch:local` | `node src/main.js --no-publish --force` |
| `npm run preview` | `node src/tools/preview.js 3` |
| `npm run check:blog` | `node src/tools/check-blog.js` |
| `npm run get-token` | `node src/tools/get-refresh-token.js` |

## 動いているか確認する

実行ログを開かなくても、次のファイルを見れば状況が分かる。

| ファイル | 分かること |
|---|---|
| `state/diagnostics.json` | 直近の実行結果（収集件数・投稿件数・認証情報の登録状況） |
| `state/notify.md` | 確認が必要な項目。空なら問題なし |
| `state/health.json` | 監視先ごとの取得の成否と連続失敗回数 |
| `state/mode.json` | 平常モードか荒天モードか |
| `state/events.jsonl` | これまでに検出した全イベントの台帳 |

## 初期設定

### 1. Blogger の準備

1. Blogger でブログを作成する
2. ブログのIDを控える（Blogger管理画面のURL `blogger.com/blog/posts/【この数字】` の部分）

### 2. Google Cloud の設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Blogger API v3** を有効化
3. 「OAuth 同意画面」を作成する
   - ユーザーの種類: 外部
   - 公開ステータス: **本番環境（In production）**

   > **テストのままにしないこと。**
   > 公開ステータスが「テスト」の場合、リフレッシュトークンは7日で失効する。
   > 自動運転が毎週止まることになるため、必ず本番環境に切り替える。
   > 本番環境でも、未確認アプリとして自分のアカウントから利用する分には問題ない
   > （認証時に警告画面が出るが「詳細」→「安全でないページに移動」で進める）。
4. 「認証情報」→「OAuth クライアント ID」を作成
   - アプリケーションの種類: **デスクトップアプリ**
5. クライアントIDとクライアントシークレットを控える

### 3. リフレッシュトークンの取得

手元で1度だけ実行する。

```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run get-token
```

表示されたURLをブラウザで開いて許可し、出てきたコードを貼り付けると
リフレッシュトークンが表示される。

### 4. 接続確認

```bash
BLOGGER_BLOG_ID=xxx GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy GOOGLE_REFRESH_TOKEN=zzz npm run check:blog
```

### 5. GitHub の設定

リポジトリの Settings → Secrets and variables → Actions で登録する。

**Secrets**

| 名前 | 内容 |
|---|---|
| `BLOGGER_BLOG_ID` | BloggerのブログID |
| `GOOGLE_CLIENT_ID` | OAuthクライアントID |
| `GOOGLE_CLIENT_SECRET` | OAuthクライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | 手順3で取得したもの |
| `MAIL_USERNAME` | 通知送信元のGmailアドレス |
| `MAIL_PASSWORD` | Gmailのアプリパスワード（通常のパスワードではない） |
| `MAIL_TO` | 通知の宛先 |

**Variables**

| 名前 | 内容 |
|---|---|
| `SITE_URL` | ブログのURL（User-Agentに入れる） |
| `CONTACT_EMAIL` | 連絡先メール（User-Agentに入れる） |
| `PHASE` | 監視する範囲。1 = 幹線3社のみ |

> **リポジトリは public を推奨。**
> private だと GitHub Actions の無料枠は月2,000分で、荒天時の実行頻度では超過しうる。
> 認証情報はすべて Secrets に置くためリポジトリには含まれない。

## 構成

```
src/
├── main.js              エントリポイント。収集→判定→公開の全体を回す
├── curator.js           差分検出。同じ欠航を二度投稿しないための中核
├── writer.js            記事の生成（題名・URL・ラベル・本文）
├── statuspage.js        航路別の常設ページ
├── publisher.js         Blogger API v3
├── watchers/
│   ├── aline.js         マルエーフェリー・奄美海運（RSS）
│   ├── marix.js         マリックスライン（RSS）
│   └── weather.js       気象庁。荒天モードの判定
└── lib/
    ├── config.js        data/*.yml の読み込み
    ├── fetcher.js       HTTP取得
    ├── rss.js           RSS解析
    ├── text.js          日付・港・方向の抽出
    ├── status.js        状態の定義と判定
    └── state.js         台帳・スナップショット・モードの保存

data/
├── routes.yml           航路・船社・船名
└── sources.yml          監視先URL

state/                   実行間で引き継ぐ状態。GitHubにコミットされる
├── events.jsonl         イベント台帳
├── snapshots/           ソースごとの前回取得結果
├── mode.json            平常 / 荒天
├── health.json          取得の健全性
└── pages.json           常設ページのID
```

## 運用上の注意

**`state/` を消さないこと。** 台帳を失うと、すでに投稿済みの欠航をもう一度投稿する。
GitHub Actions はこのディレクトリを毎回コミットして次回に引き継いでいる。

**航路の掲載を止めるには** `data/routes.yml` の該当航路を `enabled: false` にする（仕様Q36）。

**初回実行は投稿しない。** スナップショットが無い状態では、取得した記事を台帳に記録するだけで
投稿はしない。過去の案内を一斉に掘り起こさないための仕組み。
