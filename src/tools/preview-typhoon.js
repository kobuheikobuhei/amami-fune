// 台風ページを手元で組み立てて、HTMLとして書き出す。
//
//   node src/tools/preview-typhoon.js [出力先]

import { writeFileSync } from 'node:fs';
import { loadConfig, activeRouteIds } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';
import { watchKyodogumi } from '../watchers/kyodogumi.js';
import { watchTyphoon } from '../watchers/typhoon.js';
import { watchWeather } from '../watchers/weather.js';
import { toCandidates, ongoingNotices } from '../curator.js';
import { readEvents, latestEventsByKey, readPageIds } from '../lib/state.js';
import { buildTyphoonPage } from '../typhoonpage.js';

const out = process.argv[2] ?? 'tmp/preview-typhoon.html';
const cfg = loadConfig();
const now = new Date().toISOString();
const routeIds = activeRouteIds(cfg.routes, Number(process.env.PHASE ?? 1));
const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));

const W = {
  'aline-kagoshima-rss': watchAline,
  'aline-amami-rss': watchAline,
  'marix-service-rss': watchMarix,
  'kyodogumi-html': watchKyodogumi,
};
const obs = [];
for (const s of cfg.sources.filter((s) => s.role === 'primary' && W[s.id] && s.route_ids?.some((id) => routeIds.has(id)))) {
  const { observations } = await W[s.id](s, { userAgent: cfg.userAgent });
  obs.push(...observations);
}

// 台帳を後に置き、記事URLを持つ側を残す
const merged = latestEventsByKey([...toCandidates(obs, { now }), ...readEvents()]);
const eventsByRoute = {};
for (const e of merged.values()) (eventsByRoute[e.route_id] ??= []).push(e);
const noticesByRoute = ongoingNotices(obs, { now })
  .reduce((a, n) => ((a[n.route_id] ??= []).push(n), a), {});

const typhoons = (await watchTyphoon({ userAgent: cfg.userAgent }).catch(() => ({ typhoons: [] }))).typhoons;
const weather = await watchWeather(cfg.sources.find((s) => s.id === 'jma-warning-amami'), { userAgent: cfg.userAgent })
  .catch(() => null);

const page = buildTyphoonPage({
  typhoons,
  weather,
  routes: [...routeIds].map((id) => routeById[id]).filter(Boolean),
  eventsByRoute,
  noticesByRoute,
  pageIds: readPageIds(),
  now,
});

writeFileSync(out,
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>' + page.title + '</title>' +
  '<body style="margin:0;padding:14px;font-family:system-ui,sans-serif;color:#111827;max-width:720px">' +
  '<h1 style="font-size:1.4em">' + page.title + '</h1>' + page.body, 'utf8');

console.log('台風: ' + typhoons.length + '件 / 警報: ' + (weather?.rough ? 'あり' : 'なし'));
console.log('書き出し: ' + out);
