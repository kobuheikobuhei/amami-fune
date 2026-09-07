// 台帳と関係なく、いま取得できる情報から記事を組み立てて確認する
import { loadConfig, activeRouteIds } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';
import { toCandidates, publishDecision } from '../curator.js';
import { buildArticle } from '../writer.js';

const cfg = loadConfig();
const now = new Date().toISOString();
const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));
const W = { 'aline-kagoshima-rss': watchAline, 'aline-amami-rss': watchAline, 'marix-service-rss': watchMarix };

const obs = [];
for (const s of cfg.sources.filter((s) => W[s.id])) {
  const { observations } = await W[s.id](s, { userAgent: cfg.userAgent });
  obs.push(...observations);
}
const candidates = toCandidates(obs, { now });
const limit = Number(process.argv[2] ?? 2);

console.log(`候補 ${candidates.length}件\n`);
for (const c of candidates.slice(0, limit)) {
  const ev = { ...c, revisions: [{ at: now, status: c.status, detail: c.detail, source_url: c.source_url }] };
  const a = buildArticle(ev, { route: routeById[c.route_id] });
  console.log('='.repeat(72));
  console.log('題名     :', a.title);
  console.log('URL      :', a.permalink);
  console.log('ラベル   :', a.labels.join(' , '));
  console.log('公開判定 :', publishDecision(ev) === 'publish' ? '自動公開' : '下書き（要確認）');
  console.log('-'.repeat(72));
  console.log(a.body);
  console.log();
}
console.log('--- 全候補の一覧 ---');
for (const c of candidates) {
  console.log(`${c.service_date} ${String(c.status).padEnd(11)} ${String(c.origin ?? '-').padEnd(9)} ${String(c.direction ?? '-').padEnd(5)} ${c.operator_id}`);
}
