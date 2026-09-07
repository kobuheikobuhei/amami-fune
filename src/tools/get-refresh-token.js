// Blogger API のリフレッシュトークンを取得する。初回に1度だけ実行する。
//
// Google は2022年にコードを手で貼り付ける方式（OOB）を廃止したため、
// 一時的にローカルでHTTPサーバを立て、ブラウザからの戻りを受け取る方式を使う。
// 「デスクトップアプリ」種別のクライアントは localhost への戻りが標準で許可されている。
//
// 取得したリフレッシュトークンは .env.local に自動で書き込む。
// 画面には表示しないので、手で扱う必要はない。

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { loadEnvLocal, setEnvLocal, ENV_PATH } from '../lib/env.js';

loadEnvLocal();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}`;

if (!clientId || !clientSecret) {
  console.error('\n認証情報が見つかりません。');
  console.error(`${ENV_PATH} に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。`);
  console.error('.env.local.example をコピーして .env.local を作ると簡単です。\n');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/blogger');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // 毎回リフレッシュトークンを発行させる

function page(title, message, color) {
  return `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<body style="font-family:sans-serif;max-width:32em;margin:4em auto;line-height:1.7">
<h1 style="color:${color}">${title}</h1>
<p>${message}</p>
<p style="color:#666">このタブは閉じて構いません。</p>`;
}

const result = await new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT);
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }

    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
         .end(page('許可されませんでした', `理由: ${error}`, '#dc2626'));
      server.close();
      resolve({ ok: false, error });
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
         .end(page('コードが受け取れませんでした', '最初からやり直してください。', '#dc2626'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
       .end(page('認証できました', 'ターミナルに戻って結果を確認してください。', '#16a34a'));
    server.close();
    resolve({ ok: true, code });
  });

  server.listen(PORT, () => {
    console.log('\n次のURLをブラウザで開いて「許可」を押してください。');
    console.log('（自動で開かない場合は、コピーして貼り付けてください）\n');
    console.log(authUrl.toString());
    console.log('\n「このアプリは Google で確認されていません」と出たら、');
    console.log('「詳細」→「奄美の船 運航状況（安全ではないページ）に移動」で進めます。');
    console.log('\nブラウザでの操作を待っています...\n');

    // 既定のブラウザで開く。
    // Windows で cmd 経由の start を使うと URL 内の & がコマンド区切りと解釈され、
    // クエリが途中で切れてしまう。explorer.exe に直接渡せばシェルを介さないため安全。
    try {
      if (process.platform === 'win32') {
        spawn('explorer.exe', [authUrl.toString()], { stdio: 'ignore', detached: true }).unref();
      } else {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(cmd, [authUrl.toString()], { stdio: 'ignore', detached: true }).unref();
      }
    } catch {
      // 開けなくても手動で開けるので問題ない
    }
  });
});

if (!result.ok) {
  console.error('\n認証が完了しませんでした。もう一度実行してください。\n');
  process.exit(1);
}

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code: result.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }),
});

const json = await res.json();

if (!res.ok || !json.refresh_token) {
  console.error('\nトークンの取得に失敗しました。');
  console.error('返答:', JSON.stringify({ ...json, access_token: undefined }, null, 2));
  if (res.ok && !json.refresh_token) {
    console.error('\nリフレッシュトークンが含まれていません。');
    console.error('Googleアカウントのアクセス権限からこのアプリを削除して、もう一度実行してください。');
  }
  process.exit(1);
}

const path = setEnvLocal('GOOGLE_REFRESH_TOKEN', json.refresh_token);

console.log('\n取得できました。');
console.log(`リフレッシュトークンを ${path} に保存しました。`);
console.log(`（長さ ${json.refresh_token.length} 文字。内容は画面に表示していません）`);
console.log('\n次は接続確認です。ターミナルで次を実行してください:');
console.log('  npm run check:blog\n');
