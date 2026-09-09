// 奄美海運の運航スケジュールを読み取る。
//
// この航路は鹿児島航路と事情が違う。フェリーあまみが機関故障で運休中で、
// フェリーきかいが週3便の臨時体制で走っている。通常の年間配船表を使うと、
// 走っていない船を走っていることにしてしまう。
// 公式が出している「週3便運航のご案内」だけを見る。
//
// 相手が1社しかないため、鹿児島航路のような会社どうしの突き合わせができない。
// 代わりに、案内そのものが前提どおりかを毎回確かめる。
//   ・フェリーきかいが月・水・金の3列に入っている
//   ・フェリーあまみが運航する列に入っていない
//   ・持っている時刻がすべて案内に載っている
// ひとつでも外れたら体制が変わったということなので、何も表示しない。
//
// 出典: 奄美海運株式会社（A"LINE）

import { fetchText, fetchBytes } from '../lib/fetcher.js';
import { extractItems, toRows, toPlainText } from './pdftext.js';

const PAGE = 'https://www.aline-ferry.com/amami/time/';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** ページから週3便の案内のPDFを探す。図表版ではなく本文の表がある方を選ぶ */
export async function findPdfUrl({ userAgent }) {
  const { body } = await fetchText(PAGE, { userAgent });
  const found = [];
  for (const m of body.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    if (/週[3３]便/.test(text)) found.push({ url: m[1], text });
  }
  // 「（ヨコ）」は同じ内容の図表版。曜日の列がある方を使う。
  return (found.find((f) => !f.text.includes('ヨコ')) ?? found[0])?.url ?? null;
}

/**
 * 案内の表から、どの曜日にどの船が走るかを読み取る。
 *
 * 曜日の見出しと船名は別の行にあり、横位置で対応づける必要がある。
 * 見出しは列の左寄せ、船名はやや左にずれて置かれている。
 */
export function parseWeekdays(rows) {
  const headerRow = rows.find((r) => {
    const t = r.items.map((i) => i.text).join('').replace(/\s/g, '');
    return /月曜日/.test(t) && /日曜日/.test(t);
  });
  if (!headerRow) return null;

  const columns = headerRow.items
    .map((i) => ({ weekday: i.text.replace(/\s/g, '').replace('曜日', ''), x: i.x }))
    .filter((c) => WEEKDAYS.includes(c.weekday));
  if (columns.length !== 7) return null;

  const shipRow = rows.find((r) => r.items.some((i) => /^フェリー/.test(i.text)));
  if (!shipRow) return null;

  // 列の間隔より狭い範囲で一番近い見出しに寄せる
  const pitch = Math.abs(columns[1].x - columns[0].x);
  const byShip = new Map();

  for (const item of shipRow.items) {
    if (!/^フェリー/.test(item.text)) continue;
    let best = null;
    for (const c of columns) {
      const d = Math.abs(c.x - item.x);
      if (d < pitch / 2 && (!best || d < Math.abs(best.x - item.x))) best = c;
    }
    if (!best) continue;
    if (!byShip.has(item.text)) byShip.set(item.text, []);
    byShip.get(item.text).push(best.weekday);
  }

  return [...byShip.entries()].map(([ship, days]) => ({ ship, weekdays: days }));
}

/** 公式ページから案内を取り、曜日の割り当てと本文を返す */
export async function fetchNotice({ userAgent }) {
  const url = await findPdfUrl({ userAgent });
  if (!url) throw new Error('週3便運航の案内が見つかりません');
  const { bytes } = await fetchBytes(url, { userAgent });
  const pages = await extractItems(bytes);
  return {
    url,
    text: pages.map((p) => toPlainText(p)).join('\n'),
    assignments: parseWeekdays(toRows(pages[0].items, 3)),
  };
}

const toWide = (s) => s.replace(/[0-9]/g, (c) => '０１２３４５６７８９'[Number(c)]).replace(/:/g, '：');

/**
 * 案内が、持っている時刻表の前提どおりかを確かめる。
 * 外れていれば体制が変わったということなので、表示してはいけない。
 */
export function verify(notice, timetables) {
  const problems = [];
  const expectedShip = timetables.down.ship;
  const expectedDays = timetables.down.weekdays;

  const assignments = notice.assignments ?? [];
  if (!assignments.length) {
    problems.push('案内から運航する曜日を読み取れませんでした');
    return problems;
  }

  const others = assignments.filter((a) => a.ship !== expectedShip);
  if (others.length) {
    problems.push('想定していない船が運航しています（' +
      others.map((o) => o.ship + '：' + o.weekdays.join('・')).join('、') + '）');
  }

  const mine = assignments.find((a) => a.ship === expectedShip);
  if (!mine) {
    problems.push(expectedShip + 'が案内の表にありません');
  } else if (mine.weekdays.join('') !== expectedDays.join('')) {
    problems.push(expectedShip + 'の運航曜日が変わっています（案内: ' +
      mine.weekdays.join('・') + ' / 掲載: ' + expectedDays.join('・') + '）');
  }

  // 時刻がひとつでも案内に無ければ、ダイヤが変わっている
  const plain = notice.text.replace(/\s/g, '');
  for (const key of ['down', 'up']) {
    for (const stop of timetables[key].stops) {
      for (const time of [stop.arrive, stop.depart].filter(Boolean)) {
        if (!plain.includes(toWide(time))) {
          problems.push(timetables[key].label + ' ' + stop.port + ' ' + time + ' が案内に見当たりません');
        }
      }
    }
  }

  return problems;
}

/** 曜日の決まりから、窓の中の出港日を並べる */
export function departuresFor(dates, timetable) {
  const days = new Set(timetable.weekdays);
  return dates
    .filter((date) => days.has(WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()]))
    .map((date) => ({
      date,
      ship: timetable.ship,
      operator_id: 'amamikaiun',
      name: '奄美海運',
      direction: timetable.direction,
    }));
}

/**
 * 下りと上りのつながりを確かめる。
 * 鹿児島を出た翌日に平土野を折り返すので、下りの出港日の翌日が上りの出港日になる。
 */
export function checkCycle(departures) {
  const up = new Set((departures.up ?? []).map((d) => d.date));
  const problems = [];
  for (const d of departures.down ?? []) {
    const next = new Date(d.date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const key = next.toISOString().slice(0, 10);
    if (key > (departures.upTo ?? '9999-12-31')) continue;
    if (!up.has(key)) problems.push(d.date + 'に鹿児島を出た便の、翌日の折り返しがありません');
  }
  return problems;
}

export { WEEKDAYS };
