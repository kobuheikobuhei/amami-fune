// マリックスラインの年間運航スケジュール（配船予定）を読み取る。
//
// 「本来どの船がどの日に出港する予定か」を持つための処理。
// 発表された欠航や条件付運航は、この予定に対する変更として意味を持つ。
//
// 資料はPDFしかなく、HTMLで取れる形の表は存在しない。
// PDFの解析は各社がレイアウトを変えれば静かに壊れる。しかも
// もっともらしい数字を出したまま間違い続けるため、
// 抽出できた結果が妥当かを必ず検査してから使う。
//
// 出典: マリックスライン株式会社

import { fetchText, fetchBytes } from '../lib/fetcher.js';
import { extractItems, toPlainText } from './pdftext.js';

const PAGE = 'https://marixline.com/price_schedule/';
const SHIPS = ['クイーンコーラルプラス', 'クイーンコーラルクロス'];

/** ページから年間スケジュールのPDFのURLを探す。URLはハッシュ値で固定できない */
export async function findPdfUrl({ userAgent }) {
  const { body } = await fetchText(PAGE, { userAgent });
  for (const m of body.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '');
    if (/年間運航スケジュール/.test(text)) return m[1];
  }
  return null;
}

/**
 * 抽出したテキストから、月ごと・船ごとの出港日を取り出す。
 *
 * 資料は次の形で並ぶ。
 *   2026年9月
 *   クイーンコーラルプラス 3 6 9 12 16 20 24 28
 *   クイーンコーラルクロス 2 5 8 11 14 18 22 26 30
 */
export function parseSchedule(text) {
  const result = [];
  const monthRe = /(20\d\d)年(\d{1,2})月/g;
  const marks = [...text.matchAll(monthRe)].map((m) => ({
    year: Number(m[1]), month: Number(m[2]), at: m.index, end: m.index + m[0].length,
  }));

  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    const seg = text.slice(cur.end, next ? next.at : cur.end + 400);

    for (const ship of SHIPS) {
      const at = seg.indexOf(ship);
      if (at < 0) continue;
      let tail = seg.slice(at + ship.length);
      const other = SHIPS.filter((s) => s !== ship)
        .map((s) => tail.indexOf(s)).filter((n) => n >= 0);
      if (other.length) tail = tail.slice(0, Math.min(...other));

      const days = [...tail.matchAll(/(?<![\d:])(\d{1,2})(?![\d:])/g)]
        .map((m) => Number(m[1]))
        .filter((d) => d >= 1 && d <= 31);

      if (days.length) result.push({ year: cur.year, month: cur.month, ship, days });
    }
  }
  return result;
}

/**
 * 抽出結果が妥当かを検査する。
 * PDFの解析は壊れても数字を出し続けるため、使う前に必ず確かめる。
 */
/**
 * 抽出結果が妥当かを検査する。
 * PDFの解析は壊れても数字を出し続けるため、使う前に必ず確かめる。
 *
 * ドックの期間は出港日が空くため、日数が少ないこと自体は異常ではない。
 * 資料にも「←ドック→」と記されている。日数の少なさは異常として扱わず、
 * 明らかにありえない形（存在しない日、順序の乱れ、重複）だけを問題とする。
 */
export function validate(schedule) {
  const problems = [];

  if (schedule.length < 12) {
    problems.push('月と船の組み合わせが' + schedule.length + '件しかありません（1年分なら24件前後のはず）');
  }

  for (const s of schedule) {
    const label = s.year + '年' + s.month + '月 ' + s.ship;
    const last = new Date(Date.UTC(s.year, s.month, 0)).getUTCDate();

    const over = s.days.filter((d) => d > last);
    if (over.length) problems.push(label + ': その月に存在しない日が含まれます（' + over.join(',') + '）');

    const sorted = [...s.days].sort((a, b) => a - b);
    if (sorted.join(',') !== s.days.join(',')) problems.push(label + ': 日付が昇順に並んでいません');
    if (new Set(s.days).size !== s.days.length) problems.push(label + ': 同じ日が重複しています');

    // 1日も無いのは、船名だけ拾って数字を取り損ねた可能性が高い
    if (s.days.length === 0) problems.push(label + ': 出港日が1日も取れていません');
  }

  return problems;
}

/**
 * 出港日の少ない月を、ドックの可能性がある期間として拾う。
 * 異常ではないが、読者に示す際は「予定が空いている」ことに意味がある。
 */
export function sparseMonths(schedule, threshold = 5) {
  return schedule
    .filter((s) => s.days.length > 0 && s.days.length < threshold)
    .map((s) => ({ ...s, reason: '出港日が' + s.days.length + '日分のみ（ドック期間の可能性）' }));
}
/** 公式ページからPDFを探して読み取るところまでを一度に行う */
export async function fetchSchedule({ userAgent }) {
  const url = await findPdfUrl({ userAgent });
  if (!url) throw new Error('年間運航スケジュールのPDFが見つかりません');
  const { bytes } = await fetchBytes(url, { userAgent });
  const pages = await extractItems(bytes);
  const text = pages.map((p) => toPlainText(p)).join('\n');
  return { url, schedule: parseSchedule(text) };
}
