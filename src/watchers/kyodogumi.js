// 共同組海運（貨物）の船舶動静を取得する。
//
// RSSが無いため公式ページのHTMLから読み取る。書き方に3つの癖がある。
//
//  1. 日付に月が付かない
//     「7日（月）出航のみさきⅡは…」— ページ内の更新日から月を補う。
//  2. 1文に複数の日付が並び、月は最初だけ
//     「11月5日(木)10日(火)12日(木)17日(火)はみさきⅡドックのため運休」
//     — 月を後続へ引き継ぐ。
//  3. 寄港地が島名で書かれる
//     「徳之島・沖永良部条件付き運航」— 港ではなく島の名で書かれるため、
//     「◯◯港」という形を前提にした抽出では拾えない。
//
// 貨物船なので旅客の欠航とは意味合いが違うが、荷物や宅配の遅れに直結する。
// 仕様Q7により旅客便と同等に扱う。

import { fetchText } from '../lib/fetcher.js';
import { htmlToText, shortHash, stripPhoneNumbers } from '../lib/text.js';
import { classify, detailLabel } from '../lib/status.js';

// この会社が使う地名。港名ではなく島名で書かれる。
const PLACES = [
  '鹿児島', '谷山', '名瀬', '古仁屋', '喜界島', '喜界',
  '徳之島', '亀徳', '平土野', '沖永良部', '和泊', '知名', '与論',
].sort((a, b) => b.length - a.length);

const SHIPS = ['みさきⅡ', 'みさきII', 'みさき2', 'つばさ'];

/** 見出しから次の見出しまでを切り出す */
function sectionOf(text, heading) {
  const lines = text.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => l === heading || l.startsWith(heading));
  if (start < 0) return null;

  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    // 次の見出しらしき短い行で打ち切る
    if (l.length <= 14 && /案内|お知らせ|動静|予定表|運賃|会社|採用/.test(l)) break;
    out.push(l);
    if (out.length > 12) break;
  }
  return out.join('\n');
}

/** ページ内の更新日。月のない日付を補うのに使う */
function findUpdatedDate(html) {
  const m = html.match(/(20\d\d)[\/年]\s*(\d{1,2})[\/月]\s*(\d{1,2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * 文中の日付を拾う。月が現れたら以降はその月を引き継ぐ。
 * 月が一度も出てこない場合は基準日の月を使う。
 */
export function parseDates(text, base) {
  if (!base) return [];
  let month = null;
  const out = [];
  const re = /(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) month = Number(m[1]);
    const mo = month ?? base.month;
    const d = Number(m[2]);
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) continue;

    // 基準日より半年以上前の月が出たら翌年とみなす（年末年始の案内）
    let year = base.year;
    if (mo - base.month <= -6) year += 1;

    out.push(`${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

/** 島名を含めて地名を拾う */
export function parsePlaces(text) {
  const hits = [];
  let lastEnd = -1;
  const found = [];
  for (const p of PLACES) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(p, from);
      if (i < 0) break;
      found.push({ p, start: i, end: i + p.length });
      from = i + p.length;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const f of found) {
    if (f.start < lastEnd) continue;
    hits.push(f.p);
    lastEnd = f.end;
  }
  return [...new Set(hits)];
}

function findShip(text) {
  return SHIPS.find((s) => text.includes(s)) ?? null;
}

export async function watchKyodogumi(source, { userAgent }) {
  const { body: html, fetchedAt } = await fetchText(source.url, { userAgent });
  const base = findUpdatedDate(html);
  const text = stripPhoneNumbers(htmlToText(html));

  const sections = [
    { heading: '船舶動静', routeHint: null },
    { heading: 'ドック運休のご案内', routeHint: null },
  ];

  const observations = [];
  for (const { heading } of sections) {
    const content = sectionOf(text, heading);
    if (!content) continue;

    const status = classify(content);
    if (!status) continue;

    const dates = parseDates(content, base);
    const ship = findShip(content);
    const places = parsePlaces(content);

    const entries = dates.map((d) => ({
      service_date: d,
      service_date_end: null,
      status,
      direction: null,
      origin: null,
      detail: detailLabel(content, status),
      specificity: 2,
      line: content.slice(0, 200),
    }));

    observations.push({
      source_id: source.id,
      operator_id: source.operator_id,
      route_id: source.route_ids?.[0] ?? null,
      ship,
      status,
      detail: detailLabel(content, status),
      entries,
      port_notes: places.length && status === 'conditional'
        ? [{ kind: 'conditional', ports: places }]
        : [],
      service_dates: dates,
      title: heading,
      link: source.url,
      guid: source.url + '#' + heading,
      published_at: base
        ? `${base.year}-${String(base.month).padStart(2, '0')}-${String(base.day).padStart(2, '0')}T00:00:00Z`
        : fetchedAt,
      summary: content.slice(0, 600),
      body_hash: shortHash(content),
      confidence: 'A',
    });
  }

  return { fetchedAt, observations };
}
