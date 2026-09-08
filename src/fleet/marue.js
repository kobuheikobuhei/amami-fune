// マルエーフェリーの年間運航スケジュール（配船予定）を読み取る。
//
// 記号の表で、日付の見出しと記号を横位置で対応づける必要がある。
// 文字を順に並べるだけでは空欄が失われ、30日の表に記号が23個しか
// 並ばない。座標を保ったまま列へ割り当てる。
//
//   ●：鹿児島発　○：那覇発　入：入渠　ドック：ドック期間
//
// 出典: マルエーフェリー株式会社

import { fetchText, fetchBytes } from '../lib/fetcher.js';
import { extractItems, toRows, alignToColumns } from './pdftext.js';

const PAGE = 'https://www.aline-ferry.com/kagoshima/time/';
const SHIPS = ['フェリーあけぼの', 'フェリー波之上'];

/** ページから年間スケジュールのPDFのURLを探す。URLはハッシュ値で固定できない */
export async function findPdfUrl({ userAgent }) {
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
 * 月ごとに「日付・月名・曜日・船1・船2」の行が並ぶ。
 *
 * 年は表題の「２０２６年度」から取る。実行時の年から推測すると、
 * 年度末に前年度の表を読んで1年ずれるため。
 */
export async function parseSchedule(pdfBytes) {
  const pages = await extractItems(pdfBytes);
  const rows = toRows(pages[0].items);
  const texts = rows.map((r) => toHalf(r.items.map((i) => i.text).join('')));

  const fiscalYear = Number(texts.find((t) => /20\d\d年度/.test(t))?.match(/(20\d\d)年度/)?.[1]);
  if (!Number.isFinite(fiscalYear)) throw new Error('年度が読み取れません');

  // 月の見出しの位置を拾う。年度は4月始まりで、1月から翌年になる。
  const months = [];
  texts.forEach((t, index) => {
    const m = t.match(/^(\d{1,2})月$/);
    if (m) months.push({ month: Number(m[1]), index });
  });

  const out = [];
  for (const { month, index } of months) {
    // 日付の見出しは月名の1行前
    const dayRow = rows[index - 1];
    if (!dayRow) continue;
    const days = dayRow.items.map((i) => Number(toHalf(i.text))).filter(Number.isFinite);
    if (!days.length) continue;
    const cols = dayRow.items.map((i) => i.x);
    const year = month >= 4 ? fiscalYear : fiscalYear + 1;

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

/** 公式ページからPDFを探して読み取るところまでを一度に行う */
export async function fetchSchedule({ userAgent }) {
  const url = await findPdfUrl({ userAgent });
  if (!url) throw new Error('年間スケジュールのPDFが見つかりません');
  const { bytes } = await fetchBytes(url, { userAgent });
  return { url, schedule: await parseSchedule(bytes) };
}
