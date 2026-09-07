// 認証情報が正しいか、ブログに接続できるかを確認する。
// 投稿は行わない。
import { loadEnvLocal } from '../lib/env.js';
import { readCredentials, getAccessToken } from '../publisher.js';

loadEnvLocal();

const cred = readCredentials();
const token = await getAccessToken(cred);
const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${cred.blogId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const json = await res.json();
if (!res.ok) {
  console.error('接続失敗:', json?.error?.message ?? res.status);
  process.exit(1);
}
console.log('接続できました');
console.log('  ブログ名:', json.name);
console.log('  URL     :', json.url);
console.log('  投稿数  :', json.posts?.totalItems ?? '不明');
console.log('  ページ数:', json.pages?.totalItems ?? '不明');
