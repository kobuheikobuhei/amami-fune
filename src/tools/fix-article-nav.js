// 既に投稿した記事に残る、古いページ名の案内を直す。
//
// 記事の冒頭には「最新の状況は◯◯でご確認ください」という案内を焼き込んでいる。
// ページ名を変えても、既に投稿した記事の中の文字はそのまま残る。
// 存在しない名前でページへ誘導することになるので、書き換える。
//
//   node src/tools/fix-article-nav.js          対象を数えるだけ
//   node src/tools/fix-article-nav.js --apply  実際に書き換える

import { loadEnvLocal } from '../lib/env.js';
loadEnvLocal();
import { readCredentials, getAccessToken } from '../publisher.js';

const APPLY = process.argv.includes('--apply');
const FROM = '>今日・明日の運航状況</a>';
const TO = '>運航状況</a>';

const c = readCredentials();
const token = await getAccessToken(c);
const base = 'https://www.googleapis.com/blogger/v3/blogs/' + c.blogId + '/posts';

const res = await fetch(base + '?fetchBodies=true&maxResults=100', {
  headers: { Authorization: 'Bearer ' + token },
});
const json = await res.json();
if (!res.ok) throw new Error(json?.error?.message ?? ('HTTP ' + res.status));

const posts = json.items ?? [];
const targets = posts.filter((p) => (p.content ?? '').includes(FROM));

console.log('記事 ' + posts.length + '件 / 書き換え対象 ' + targets.length + '件' + (APPLY ? '' : '（確認のみ）'));

for (const p of targets) {
  if (!APPLY) {
    console.log('  ' + p.title);
    continue;
  }
  const content = p.content.split(FROM).join(TO);
  const r = await fetch(base + '/' + p.id, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const out = await r.json();
  console.log((r.ok ? '  直しました  ' : '  失敗  ') + p.title + (r.ok ? '' : ' — ' + (out?.error?.message ?? r.status)));
  await new Promise((s) => setTimeout(s, 400));
}
