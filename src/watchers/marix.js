// マリックスラインのRSSを正規化する。
//
// タイトルに日付・出発港・方向・状態が全て入っている。
// 例: 2026年9月6日（日） 鹿児島新港発 奄美群島経由 那覇港向け 下り便【臨時便・航行経路変更】
// 1記事＝1便なので、A"LINE のような本文の行解析は不要。
//
// ただし平常運航の告知だけは【】が付かず、RSSの本文も空になる。
// その場合に限り記事ページを取りに行って状態を判定する。

import { fetchFeed } from '../lib/rss.js';
import {
  extractDateUnits, extractDirection, extractOrigin, shortHash,
} from '../lib/text.js';
import { classify, detailLabel } from '../lib/status.js';
import { fetchDetail } from './marix-detail.js';

/** タイトル末尾の【...】を取り出す。状態判定はこの中だけを見る */
function extractBracket(title) {
  const m = title.match(/【([^】]+)】/);
  return m ? m[1] : null;
}


export async function watchMarix(source, { userAgent, known = new Set() }) {
  const { items, fetchedAt } = await fetchFeed(source.url, { userAgent });
  const observations = [];

  for (const item of items) {
    const bracket = extractBracket(item.title);
    const statusText = bracket ?? item.title;

    let status = classify(statusText);
    let detail = detailLabel(statusText, status);

    // 個別ページには船名と港ごとの状態が入っている。
    // すでに台帳にある発表は取りに行かない（監視先への負担を増やさないため）。
    let ship = null;
    let portNotes = [];
    const isKnown = known.has(item.link);

    if (!isKnown) {
      try {
        const d = await fetchDetail(item.link, { userAgent });
        ship = d.ship;
        portNotes = d.port_notes;
        if (!bracket && d.statusText) {
          // 括弧の無い発表は平常運航の告知。個別ページの文言で確かめる。
          status = classify(d.statusText);
          detail = detailLabel(d.statusText, status);
        }
      } catch {
        // 取れなくても、タイトルから分かる範囲で続ける
      }
    }
    if (!bracket && !status) status = 'normal';

    const units = extractDateUnits(item.title, item.pubDate ?? fetchedAt);
    const direction = extractDirection(item.title);
    // 「◯◯発」より前に出る港名が出発港。「那覇港向け」の向け先と取り違えないよう、
    // タイトルの「発」までを対象にする。
    const beforeHatsu = item.title.split('発')[0] ?? item.title;
    const origin = extractOrigin(beforeHatsu);

    const entries = status
      ? units.map((u) => ({
          service_date: u.from,
          service_date_end: u.to ?? null,
          status,
          direction,
          origin,
          detail,
          specificity: 3,
          line: item.title,
        }))
      : [];

    observations.push({
      source_id: source.id,
      operator_id: source.operator_id,
      route_id: 'marix-main',
      ship,
      status,
      detail,
      entries,
      port_notes: portNotes,
      service_dates: units.map((u) => u.from),
      title: item.title,
      link: item.link,
      guid: item.guid,
      published_at: item.pubDate,
      summary: item.title,
      body_hash: shortHash(item.title),
      confidence: 'A',
    });
  }

  return { fetchedAt, observations };
}
