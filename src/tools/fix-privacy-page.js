// プライバシーポリシーのページを pages/privacy.html の内容で整形し直す。
// Bloggerの編集画面に貼り付けたときHTMLタグが外れてしまったものを、APIから直す。
import { readFileSync } from 'node:fs';
import { loadEnvLocal } from '../lib/env.js';
import { BloggerPublisher, readCredentials } from '../publisher.js';

loadEnvLocal();

const PAGE_ID = process.argv[2];
if (!PAGE_ID) {
  console.error('使い方: node src/tools/fix-privacy-page.js <ページID>');
  process.exit(1);
}

const contact = process.env.CONTACT_EMAIL ?? '';
const body = readFileSync('pages/privacy.html', 'utf8')
  .replace('＜連絡用メールアドレス＞', contact);

const publisher = new BloggerPublisher({ credentials: readCredentials() });
const r = await publisher.upsertPage(PAGE_ID, {
  title: 'プライバシーポリシー',
  body,
});

console.log('更新しました');
console.log('  ページID:', r.id);
console.log('  URL     :', r.url ?? '(取得できず)');
