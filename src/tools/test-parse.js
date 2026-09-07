// 実際のフィードを取得して正規化結果を目視確認するための検証スクリプト
import { loadConfig } from '../lib/config.js';
import { watchAline } from '../watchers/aline.js';
import { watchMarix } from '../watchers/marix.js';

const cfg = loadConfig();
const byId = Object.fromEntries(cfg.sources.map((s) => [s.id, s]));

const targets = [
  ['aline-kagoshima-rss', watchAline],
  ['aline-amami-rss', watchAline],
  ['marix-service-rss', watchMarix],
];

for (const [id, fn] of targets) {
  const src = byId[id];
  console.log(`\n${'='.repeat(70)}\n${id}  ${src.url}\n${'='.repeat(70)}`);
  try {
    const { observations } = await fn(src, { userAgent: cfg.userAgent });
    for (const o of observations.slice(0, 5)) {
      console.log(
        [
          `状態    : ${o.status ?? '★判定不可'}  (${o.detail ?? '-'})`,
          `航路/船 : ${o.route_id} / ${o.ship ?? '-'}`,
          `対象日  : ${o.service_dates.join(', ') || '-'}   方向: ${o.direction ?? '-'}`,
          `題名    : ${o.title}`,
          `URL     : ${o.link}`,
        ].join('\n  ')
      );
      console.log('  ' + '-'.repeat(66));
    }
  } catch (e) {
    console.log('  取得失敗:', e.message);
  }
}
