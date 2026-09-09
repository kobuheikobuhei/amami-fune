// 解析を直したときに、すでに投稿した記事を現在の判定へ揃える。
//
// 記事は「公式の発表が新しくなったとき」だけ書き換える作りにしている。
// こちらの解析を直しても発表の日付は変わらないので、古い判定のまま残る。
//
// 共同組海運のドック案内は「運休となります」と明記しているのに、
// 記事は「ドック入り」とだけ書いていた。公式が運休と言っているものを
// 弱めて伝えることになるので、一度だけ揃える。
//
// 発表そのものは変わっていないため、続報としては扱わない（更新履歴を足さない）。
//
//   node src/tools/resync-articles.js          違いを見るだけ
//   node src/tools/resync-articles.js --apply  実際に揃える

import { loadEnvLocal } from '../lib/env.js';
loadEnvLocal();

import { loadConfig, activeRouteIds } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';
import { watchKyodogumi } from '../watchers/kyodogumi.js';
import { toCandidates } from '../curator.js';
import { buildArticle, buildTitle } from '../writer.js';
import { readEvents, latestEventsByKey, appendEvent, readPageIds } from '../lib/state.js';
import { buildArticleNav } from '../nav.js';
import { BloggerPublisher, readCredentials } from '../publisher.js';

const APPLY = process.argv.includes('--apply');
const PHASE = Number(process.env.PHASE ?? 1);
const W = {
  'aline-kagoshima-rss': watchAline,
  'aline-amami-rss': watchAline,
  'marix-service-rss': watchMarix,
  'kyodogumi-html': watchKyodogumi,
};

const cfg = loadConfig();
const now = new Date().toISOString();
const routeIds = activeRouteIds(cfg.routes, PHASE);
const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));

const observations = [];
for (const s of cfg.sources.filter((s) => s.role === 'primary' && W[s.id] && s.route_ids?.some((id) => routeIds.has(id)))) {
  const { observations: o } = await W[s.id](s, { userAgent: cfg.userAgent });
  observations.push(...o);
}

const ledger = latestEventsByKey(readEvents());
const targets = [];

for (const c of toCandidates(observations, { now })) {
  const prev = ledger.get(c.event_key);
  if (!prev?.published_post?.id) continue;
  if (prev.status === c.status && prev.detail === c.detail) continue;

  // 発表そのものは変わっていないので、更新履歴は足さずに判定だけ差し替える
  const event = { ...prev, status: c.status, detail: c.detail };
  targets.push({ prev, event });
}

console.log('揃える記事 ' + targets.length + '件' + (APPLY ? '' : '（確認のみ）'));
for (const t of targets) {
  console.log('  ' + buildTitle(t.prev));
  console.log('   →  ' + buildTitle(t.event));
}

if (!APPLY || !targets.length) process.exit(0);

const publisher = new BloggerPublisher({ credentials: readCredentials(), dryRun: false });
const nav = buildArticleNav(readPageIds());

for (const t of targets) {
  const article = buildArticle(t.event, { route: routeById[t.event.route_id], nav });
  try {
    await publisher.update(t.event.published_post.id, article);
    appendEvent(t.event);
    console.log('  直しました  ' + article.title);
  } catch (err) {
    console.log('  失敗  ' + article.title + ' — ' + err.message);
  }
  await new Promise((r) => setTimeout(r, 400));
}
