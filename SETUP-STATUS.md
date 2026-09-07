# セットアップ進捗

| | 段階 | 状態 |
|---|---|---|
| 1 | Bloggerでブログを作る | **完了** |
| 2 | Google CloudでAPIの設定 | **完了**（本番環境／OAuthクライアントは要確認） |
| 3 | リフレッシュトークンを取る | 作業中 |
| 4 | 接続確認 | — |
| 5 | 記事1件で試し投稿 | — |
| 6 | GitHubリポジトリとSecrets登録 | — |
| 7 | 自動運転を開始 | — |

## 確定した値

| 項目 | 値 |
|---|---|
| サイト名 | 奄美の船 運航状況 |
| Googleアカウント | 運営者のGoogleアカウント（ブログとGoogle Cloudで共通） |
| Cloudプロジェクト | amami-fune |
| ブログID | `4367194671988765738` |
| ブログのアドレス | `amami-fune.blogspot.com` |
| プライバシーポリシー | `https://amami-fune.blogspot.com/p/blog-page.html`（ページID 2499861743660524629） |
| Blogger API | 有効 |
| OAuth公開ステータス | 本番環境（外部・未確認アプリ） |
| 承認済みドメイン | amami-fune.blogspot.com |
| 公開範囲 | 限定公開（作成者のみ）で開始し、動作確認後に一般公開へ切り替える |

ブログIDは秘密情報ではない。IDだけでは投稿できず、投稿にはOAuthの認証情報が必要。

## 未対応のメモ

- プライバシーポリシーのページはHTMLタグが外れた状態で公開されている。
  段階4で接続が通ったら、publisher.js の upsertPage で整形し直す。
  ページIDは 2499861743660524629。
- 冒険あそび倉庫のAISマップを reference_links に追加する（監視はしない）。
  https://www.bouken-asobi.com/map_ais.html

## 段階2で控える値

- クライアントID（`...apps.googleusercontent.com` の形）
- クライアントシークレット
