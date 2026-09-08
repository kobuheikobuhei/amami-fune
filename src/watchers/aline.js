// マルエーフェリー・奄美海運（A"LINE）のRSSを正規化する。
//
// このサイトの記事は1本の中に複数の便と複数の状態が同居する。
// 例:「欠航案内」の本文に【欠航便】と【臨時便】の両方が入る。
// そのため記事単位ではなく行単位で解析し、
//   1. 行そのものに状態語があればそれを採用する
//   2. なければ直前の見出し（【欠航便】《運航スケジュール変更のご案内》など）の状態を継ぐ
//   3. それも無ければ記事タイトルの状態を使う
// という優先順位で状態を決める。
//
// 日付は「9月3日～9月14日」のような期間になることがある（ドック入りなど）。
// 期間を2つの独立した日として扱うと間の日が抜け落ちるため、期間は1件として保持する。
//
// 船は記事URLのスラッグから確実に特定できる。

import { fetchFeed } from '../lib/rss.js';
import {
  htmlToText, extractDateUnits, extractDirection, extractOrigin, shortHash,
  stripPhoneNumbers, cutContactBlock, extractPortNotes,
} from '../lib/text.js';
import { classify, detailLabel, detailPhrase } from '../lib/status.js';

const SHIP_BY_SLUG = {
  'ferry-akebono': 'フェリーあけぼの',
  'ferry-naminoue': 'フェリー波之上',
  'ferry-kikai': 'フェリーきかい',
  'ferry-amami': 'フェリーあまみ',
};

const ROUTE_BY_SLUG = {
  'route-kagoshima': { routeId: 'marue-main', operatorId: 'marue' },
  'route-amami': { routeId: 'amamikaiun-kikai', operatorId: 'amamikaiun' },
};

function parseLink(link) {
  const shipSlug = Object.keys(SHIP_BY_SLUG).find((s) => link.includes(`/${s}/`));
  const routeSlug = Object.keys(ROUTE_BY_SLUG).find((s) => link.includes(`/${s}/`));
  return {
    ship: shipSlug ? SHIP_BY_SLUG[shipSlug] : null,
    ...(routeSlug ? ROUTE_BY_SLUG[routeSlug] : { routeId: null, operatorId: null }),
  };
}

/** 行中の最後の見出し【…】《…》を返す */
function headingIn(line) {
  const matches = [...line.matchAll(/[【《]([^】》]{1,20})[】》]/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/**
 * 本文を行単位で解析し、便ごとの状態を取り出す。
 * 日付を含まない行はイベントにしない（事実が特定できないため）。
 */
export function parseBody(bodyText, { baseDate, titleStatus }) {
  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];
  let headingStatus = null;

  for (const line of lines) {
    const heading = headingIn(line);
    if (heading) {
      const hs = classify(heading);
      if (hs) headingStatus = hs;
    }

    const units = extractDateUnits(line, baseDate);
    if (units.length === 0) continue;

    const status = classify(line) ?? headingStatus ?? titleStatus;
    if (!status) continue;

    // 情報の確かさを点数化する。
    // 1行に日付の塊が2つ以上あるのは「それに伴い9月5日…ならびに9月6日…」のような
    // 要約文で、どの便がどの状態か対応づけられない。期間（9月3日～9月14日）は
    // 塊が1つなので曖昧ではない。
    const specificity = units.length > 1 ? 1 : heading ? 3 : 2;

    for (const u of units) {
      entries.push({
        service_date: u.from,
        service_date_end: u.to ?? null,
        status,
        direction: specificity === 1 ? null : extractDirection(line),
        origin: specificity === 1 ? null : extractOrigin(line),
        detail: detailPhrase(line, status) ?? detailPhrase(heading ?? '', status) ?? null,
        specificity,
        line,
      });
    }
  }

  // 同じ日付・同じ状態については、最も確実な行から得たものだけを残す。
  // これにより要約文由来の誤った方向が、見出し付きの行に負けて消える。
  const maxSpec = new Map();
  for (const e of entries) {
    const k = `${e.service_date}|${e.service_date_end ?? ''}|${e.status}`;
    maxSpec.set(k, Math.max(maxSpec.get(k) ?? 0, e.specificity));
  }

  const kept = new Map();
  for (const e of entries) {
    const k = `${e.service_date}|${e.service_date_end ?? ''}|${e.status}`;
    if (e.specificity < maxSpec.get(k)) continue;
    const key = `${k}|${e.origin ?? ''}|${e.direction ?? ''}`;
    if (!kept.has(key)) kept.set(key, e);
  }
  return [...kept.values()].sort((a, b) => a.service_date.localeCompare(b.service_date));
}

export async function watchAline(source, { userAgent }) {
  const { items, fetchedAt } = await fetchFeed(source.url, { userAgent });

  const observations = items.map((item) => {
    const body = cutContactBlock(stripPhoneNumbers(htmlToText(item.contentHtml)));
    const { ship, routeId, operatorId } = parseLink(item.link);
    const baseDate = item.pubDate ?? fetchedAt;

    // 記事全体の状態はタイトルで決める。本文の付随的な語に引きずられないようにする。
    const titleStatus = classify(item.title) ?? classify(body);
    const entries = parseBody(body, { baseDate, titleStatus });

    return {
      source_id: source.id,
      operator_id: operatorId ?? source.operator_id,
      route_id: routeId ?? source.route_ids?.[0] ?? null,
      ship,
      status: titleStatus,
      detail: detailPhrase(item.title, titleStatus) ?? detailPhrase(body, titleStatus),
      entries,
      port_notes: extractPortNotes(body),
      service_dates: [...new Set(entries.map((e) => e.service_date))].sort(),
      title: item.title,
      link: item.link,
      guid: item.guid,
      published_at: item.pubDate,
      summary: body.slice(0, 600),
      body_hash: shortHash(body),
      confidence: 'A',
    };
  });

  return { fetchedAt, observations };
}
