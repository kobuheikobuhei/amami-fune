// 次の節目までの秒数を返す。ワークフローの待ち時間に使う。
//
//   node src/tools/next-check.js
//   → 1740 18:00 鹿児島新港発／発表の確認
//
// 12分ごとという機械的な刻みでは、18:00に鹿児島を出た船が
// 18:11まで「次の出港」のまま残る。意味のある時刻はこちらで分かっているので、
// そこまで待って起きる。

import { loadConfig } from '../lib/config.js';
import { readMode } from '../lib/state.js';
import { nextCheckpoint } from '../scheduler.js';

const cfg = loadConfig();
const mode = readMode().mode ?? 'normal';
const next = nextCheckpoint(new Date().toISOString(), cfg.timetables, { mode });

process.stdout.write(next.seconds + ' ' + next.time + ' ' + next.why + '\n');
