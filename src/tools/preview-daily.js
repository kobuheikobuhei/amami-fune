// 「運航状況」ページを手元で組み立てて、HTMLとして書き出す。
// 公開せずに見た目と中身を確かめるための道具。
//
//   node src/tools/preview-daily.js [出力先]

import { writeFileSync } from 'node:fs';
import { loadConfig, activeRouteIds } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';
import { toCandidates, ongoingNotices, normalShips } from '../curator.js';
import { readEvents, latestEventsByKey, readFleet } from '../lib/state.js';
import { buildDailyPage } from '../dailypage.js';
import { buildFleetView } from '../fleet/voyages.js';
import { fetchFleet, shouldRefresh } from '../fleet/index.js';
import { buildScopeNotice } from '../scope.js';

const out = process.argv[2] ?? 'tmp/preview-daily.html';
const cfg = loadConfig();
const now = new Date().toISOString();
const routeIds = activeRouteIds(cfg.routes, Number(process.env.PHASE ?? 1));
const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));

const W = { 'aline-kagoshima-rss': watchAline, 'aline-amami-rss': watchAline, 'marix-service-rss': watchMarix };
const obs = [];
for (const s of cfg.sources.filter((s) => W[s.id])) {
  const { observations } = await W[s.id](s, { userAgent: cfg.userAgent });
  obs.push(...observations);
}

// 台帳を後に置き、記事URLを持つ側を残す（新しい候補にはURLがまだ無い）
const merged = latestEventsByKey([...toCandidates(obs, { now }), ...readEvents()]);
const eventsByRoute = {};
for (const e of merged.values()) {
  (eventsByRoute[e.route_id] ??= []).push({ ...e, operator_id: routeById[e.route_id]?.operator_id ?? null });
}
const noticesByRoute = ongoingNotices(obs, { now }).reduce((a, n) => ((a[n.route_id] ??= []).push(n), a), {});
const normalByRoute = normalShips(obs, { now }).reduce((a, n) => ((a[n.route_id] ??= []).push(n), a), {});

let fleet = readFleet();
if (shouldRefresh(fleet, now)) fleet = await fetchFleet({ userAgent: cfg.userAgent, now });
const fleetView = buildFleetView(fleet, cfg.timetables);

const page = buildDailyPage({
  routes: [...routeIds].map((id) => routeById[id]).filter(Boolean),
  eventsByRoute, noticesByRoute, operators: cfg.operators, normalByRoute,
  fleet: fleetView,
  scope: buildScopeNotice({ routes: cfg.routes, routeIds, operators: cfg.operators }),
  now,
});

writeFileSync(out,
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>' + page.title + '</title>' +
  '<body style="margin:0;padding:14px;font-family:system-ui,sans-serif;color:#111827;max-width:720px">' +
  '<h1 style="font-size:1.4em">' + page.title + '</h1>' + page.body, 'utf8');

console.log('題名: ' + page.title);
console.log('配船: ' + (fleetView ? fleetView.directions.map(d => d.label + ' ' + d.voyages.length + '便').join(' / ') : 'なし'));
console.log('書き出し: ' + out);
