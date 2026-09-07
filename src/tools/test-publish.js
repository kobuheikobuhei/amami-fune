// 記事1件の試し投稿。パーマリンクが意図どおりに付くかを実地で確認する。
//
//   node src/tools/test-publish.js          … 1件投稿する
//   node src/tools/test-publish.js <投稿ID> … 投稿を削除する
//
// 台帳には記録しないため、確認が終わったら削除しておくこと。

import { loadEnvLocal } from '../lib/env.js';
import { loadConfig } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';
import { toCandidates, publishDecision } from '../curator.js';
import { buildArticle } from '../writer.js';
import { BloggerPublisher, readCredentials } from '../publisher.js';

loadEnvLocal();

const publisher = new BloggerPublisher({ credentials: readCredentials() });

const pickArg = process.argv.indexOf('--pick');
const pickIndex = pickArg >= 0 ? Number(process.argv[pickArg + 1]) : null;
const deleteId = pickArg >= 0 ? null : process.argv[2];
if (deleteId) {
  await publisher.deletePost(deleteId);
  console.log('投稿を削除しました:', deleteId);
  process.exit(0);
}

const cfg = loadConfig();
const now = new Date().toISOString();
const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));
const W = {
  'aline-kagoshima-rss': watchAline,
  'aline-amami-rss': watchAline,
  'marix-service-rss': watchMarix,
};

const obs = [];
for (const s of cfg.sources.filter((s) => W[s.id])) {
  const r = await W[s.id](s, { userAgent: cfg.userAgent });
  obs.push(...r.observations);
}

const candidates = toCandidates(obs, { now });
if (!candidates.length) {
  console.log('いま投稿できる候補がありません（欠航・臨時便の発表がない状態です）。');
  process.exit(0);
}

// 自動公開になる候補を優先して選ぶ
const target =
  pickIndex !== null
    ? candidates[pickIndex]
    : candidates.find((c) => publishDecision({ ...c, confidence: 'A' }) === 'publish') ?? candidates[0];

if (!target) {
  console.error('指定した番号の候補がありません。');
  process.exit(1);
}

const event = {
  ...target,
  revisions: [{ at: now, status: target.status, detail: target.detail, source_url: target.source_url }],
};
const article = buildArticle(event, { route: routeById[target.route_id] });

console.log('投稿する内容:');
console.log('  題名        :', article.title);
console.log('  期待するURL :', article.permalink);
console.log('  ラベル      :', article.labels.join(' , '));
console.log('  根拠        :', event.source_url);
console.log('');

const result = await publisher.createPublished(article);

console.log('投稿しました');
console.log('  投稿ID  :', result.id);
console.log('  実際のURL:', result.url);
console.log('');

const expected = `${article.permalink}.html`;
if (result.url && result.url.endsWith(expected)) {
  console.log('パーマリンクは意図どおりです。');
} else {
  console.log('パーマリンクが想定と違います。');
  console.log('  期待: ...' + expected);
  console.log('  実際: ' + result.url);
}

console.log('');
console.log('確認が終わったら次で削除してください:');
console.log(`  node src/tools/test-publish.js ${result.id}`);
