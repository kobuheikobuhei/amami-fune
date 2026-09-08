// マリックスラインの公式検索から、日付ごとの運航予定を取る。
//
// 「時刻表と運賃を検索」は日付と区間を送ると、その日の便の時刻と
// 「運航予定の船」を返す。運航しない日は時刻表そのものを返さない。
// 会社自身が日付ごとに公表している唯一の情報源で、年間予定表の
// PDFを読むより確かめようがある。
//
// 相手先への負荷を避けるため、呼ぶのは1日1回、必要な日数だけにする。

import { fetchText } from '../lib/fetcher.js';

const ENDPOINT = 'https://marixline.com/price_schedule/';

const SHIP_BY_SLUG = {
  queen_coral_cross: 'クイーンコーラルクロス',
  queen_coral_plus: 'クイーンコーラルプラス',
};

/** 検索結果のHTMLから、その日の便を読み取る。便が無い日は null */
export function parseResult(html, date) {
  // 時刻表そのものが返らない日は、その区間に便が無い。
  if (!html.includes('航路時刻表')) return null;

  const slug = html.match(/marixline\.com\/(queen_coral_[a-z]+)\/"[\s\S]{0,300}?運航予定の船/)?.[1];
  const ship = SHIP_BY_SLUG[slug];
  if (!ship) return null;

  // 表示された出港時刻。持っている時刻表と食い違っていないかを確かめるために使う。
  const table = html.slice(html.indexOf('航路時刻表'));
  const depart = table.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/出港\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*(\d{1,2}:\d{2})/)?.[1];

  return { date, ship, depart: depart ?? null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 1日分を問い合わせる。
 * 相手先は日付ごとに1回叩く作りなので、失敗しても粘りすぎない。
 * 短い間隔で続けて叩くと拒まれるため、待ってから1度だけやり直す。
 */
export async function fetchDate(date, { userAgent, from = 'kagoshima', to = 'naha', retries = 2 }) {
  const body = new URLSearchParams({
    date, location_start: from, location_end: to, adult: '1', child: '0',
  }).toString();

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(5000 * attempt);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return parseResult(await res.text(), date);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** 日付の並びをまとめて問い合わせる。1件ずつ順に、間を空けて呼ぶ */
export async function fetchDates(dates, { userAgent, from = 'kagoshima', to = 'naha', waitMs = 2000 }) {
  const out = [];
  for (const date of dates) {
    if (out.length) await new Promise((r) => setTimeout(r, waitMs));
    const r = await fetchDate(date, { userAgent, from, to });
    if (r) out.push(r);
  }
  return out;
}

export { ENDPOINT, fetchText };
