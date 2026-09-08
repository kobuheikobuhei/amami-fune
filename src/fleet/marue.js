// マルエーフェリーの年間運航スケジュール（配船予定）を読み取る。
//
// 記号の表で、日付の見出しと記号を横位置で対応づける必要がある。
// 文字を順に並べるだけでは空欄が失われ、30日の表に記号が23個しか
// 並ばない。座標を保ったまま列へ割り当てる。
//
//   ●：鹿児島発　○：那覇発　入：入渠　ドック：ドック期間
//
// 出典: マルエーフェリー株式会社

import { extractItems, toRows, alignToColumns } from './pdftext.js';

const PAGE = 'https://www.aline-ferry.com/kagoshima/time/';
const SHIPS = ['フェリーあけぼの', 'フェリー波之上'];

/** ページから年間スケジュールのPDFのURLを探す。URLはハッシュ値で固定できない */
export async function findPdfUrl(fetchText, { userAgent }) {
  const { body } = await fetchText(PAGE, { userAgent });
  for (const m of body.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '');
    if (/年間スケジュール/.test(text)) return m[1];
  }
  return null;
}

const toHalf = (s) => s.replace(/[０-９]/g, (c) => String('０１２３４５６７８９'.indexOf(c)));

const SYMBOL = {
  '●': 'kagoshima',   // 鹿児島発
  '○': 'naha',        // 那覇発
  '〇': 'naha',        // 同じ意味の別の文字が混在する
  '入': 'dock',        // 入渠
};

/**
 * 年度分の配船を読み取る。
 * 月ごとに「日付・月名・曜日・船1・船2」の5行が並ぶ。
 */
export async function parseSchedule(pdfBytes) {
  const pages = await extractItems(pdfBytes);
  const rows = toRows(pages[0].items);

  // 月の見出しの位置を拾う。年度は4月始まりで、1月から翌年になる。
  const months = [];
  rows.forEach((r, index) => {
    const t = toHalf(r.items.map((i) => i.text).join(''));
    const m = t.match(/^(\d{1,2})月$/);
    if (m) months.push({ month: Number(m[1]), index });
  });

  const out = [];
  let year = null;
  let prevMonth = null;

  for (const { month, index } of months) {
    // 日付の見出しは月名の1行前
    const dayRow = rows[index - 1];
    if (!dayRow) continue;
    const days = dayRow.items.map((i) => Number(toHalf(i.text))).filter(Number.isFinite);
    if (!days.length) continue;
    const cols = dayRow.items.map((i) => i.x);

    // 年度は4月始まり。月が戻ったら翌年へ。
    if (year === null) year = 2000 + Number(String(new Date().getFullYear()).slice(2));
    if (prevMonth !== null && month < prevMonth) year += 1;
    prevMonth = month;

    for (const ship of SHIPS) {
      const shipRow = rows.slice(index + 1, index + 4)
        .find((r) => r.items.some((i) => i.text.includes(ship)));
      if (!shipRow) continue;

      const marks = shipRow.items.filter((i) => /^[●○〇入]$|ドック/.test(i.text));
      const cells = alignToColumns(marks, cols);

      const entries = [];
      cells.forEach((cell, n) => {
        if (!cell || !days[n]) return;
        const kind = cell.includes('ドック') ? 'dock' : SYMBOL[cell];
        if (!kind) return;
        entries.push({ day: days[n], kind });
      });

      if (entries.length) out.push({ year, month, ship, entries });
    }
  }

  return out;
}

/** 年度の始まりの年を、表そのものから決められない場合に補正する */
export function withFiscalYear(schedule, startYear) {
  let year = startYear;
  let prev = null;
  return schedule.map((s) => {
    if (prev !== null && s.month < prev) year += 1;
    prev = s.month;
    return { ...s, year };
  });
}
