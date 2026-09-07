import { loadConfig } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
const cfg = loadConfig();
const byId = Object.fromEntries(cfg.sources.map((s) => [s.id, s]));
for (const id of ['aline-kagoshima-rss', 'aline-amami-rss']) {
  const { observations } = await watchAline(byId[id], { userAgent: cfg.userAgent });
  console.log(`\n### ${id}`);
  for (const o of observations.filter(x => x.entries.length)) {
    console.log(`\n[記事] ${o.title} / ${o.ship} (記事状態: ${o.status})`);
    for (const e of o.entries) {
      console.log(`   ${e.service_date}  ${e.status.padEnd(11)} ${(e.direction ?? '-').padEnd(5)} ${e.detail ?? '-'}`);
      console.log(`      根拠行: ${e.line.slice(0, 60)}`);
    }
  }
}
