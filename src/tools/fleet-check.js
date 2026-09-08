// 配船予定の解析を手元で確かめるための道具。
//
// PDFの解析は壊れても数字を出し続けるため、自動処理に組み込む前に
// 抽出結果と検査結果を人の目で確認する。
//
//   node src/tools/fleet-check.js <抽出したテキストのファイル>
//
// PDFからのテキスト抽出は別の道具で行い、その結果をここへ渡す。

import { readFileSync } from 'node:fs';
import { parseSchedule, validate, sparseMonths } from '../fleet/marix.js';

const path = process.argv[2];
if (!path) {
  console.error('使い方: node src/tools/fleet-check.js <テキストファイル>');
  process.exit(1);
}

const schedule = parseSchedule(readFileSync(path, 'utf8'));

console.log('抽出できた月と船の組み合わせ:', schedule.length, '件');
console.log('');
for (const s of schedule) {
  console.log('  ' + s.year + '年' + String(s.month).padStart(2) + '月  ' +
    s.ship.padEnd(14) + s.days.length + '日分  ' + s.days.join(' '));
}

const problems = validate(schedule);
console.log('');
console.log('検査:', problems.length ? problems.length + '件の問題' : '問題なし');
for (const p of problems) console.log('  ★', p);

const sparse = sparseMonths(schedule);
if (sparse.length) {
  console.log('');
  console.log('出港日の少ない月（ドック期間の可能性）:');
  for (const s of sparse) console.log('  ' + s.year + '年' + s.month + '月 ' + s.ship + ' → ' + s.days.join(' '));
}
