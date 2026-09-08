// マリックスラインの運航状況の一覧ページを読み取る。
//
// RSSは最新10件しか返さないが、この一覧には19件が載っており、
// 状態も class として構造化されている。
//
//   <a class="status_single cancel alert" href="…/upstream20260907/">
//     <p class="exp">欠航</p>
//     … 2026年9月7日 / 那覇港発 …
//
// タイトルの文字列から状態を推し量る必要がなく、取りこぼしも減る。
// RSSは補助として残す（一覧の作りが変わったときの備え）。

import { fetchText } from '../lib/fetcher.js';

// class に現れる語と、こちらの状態の対応
const STATUS_BY_CLASS = [
  [/cancel/, 'cancelled'],
  [/conditional/, 'conditional'],
  [/temporary/, 'extra'],
  [/route/, 'extra'],
  [/normal/, 'normal'],
];

function statusOf(cls) {
  for (const [re, status] of STATUS_BY_CLASS) if (re.test(cls)) return status;
  return null;
}

const clean = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();

/**
 * URLから運航日と方向を読み取る。
 * 一覧の簡略な項目には日付が載らないが、URLに入っている。
 *   downstream20260905 → 2026-09-05 の下り便
 *   upstream20260907   → 2026-09-07 の上り便
 * 臨時便は service6731 のような通し番号で、日付を含まない。
 */
export function fromUrl(url) {
  const m = url.match(new RegExp('(downstream|upstream)(20[0-9]{2})([0-9]{2})([0-9]{2})'));
  if (!m) return {};
  return {
    service_date: m[2] + '-' + m[3] + '-' + m[4],
    direction: m[1] === 'downstream' ? 'down' : 'up',
  };
}

/** 一覧の項目を取り出す。同じ便が複数箇所に載るためURLで重複を除く */
export function parseList(html) {
  const seen = new Map();
  const re = /<a class="status_single ([^"]*)" href="([^"]+)">([\s\S]*?)<\/a>/g;
  let m;

  while ((m = re.exec(html)) !== null) {
    const cls = m[1].trim();
    const url = m[2];
    const inner = m[3];

    const status = statusOf(cls);
    if (!status) continue;

    const texts = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((x) => clean(x[1])).filter(Boolean);

    const label = clean((inner.match(/class="exp">([\s\S]*?)<\/p>/) ?? [])[1]);
    const dates = texts.filter((t) => /^20\d\d年\d{1,2}月\d{1,2}日$/.test(t));
    const ports = texts.filter((t) => /発$|向け$/.test(t));

    const prev = seen.get(url);
    // 情報の多い方を残す。一覧には同じ便が簡略版と詳細版で並ぶ。
    if (!prev || texts.length > prev.texts.length) {
      seen.set(url, { url, status, label, dates, ports, texts, cls });
    }
  }

  // 日付が載っていない項目は、URLから補う
  return [...seen.values()].map((x) => ({ ...x, ...fromUrl(x.url) }));
}

export async function fetchList({ userAgent }) {
  const { body, fetchedAt } = await fetchText('https://marixline.com/service/', { userAgent });
  return { fetchedAt, items: parseList(body) };
}
