// マリックスラインのRSSを正規化する。
// タイトルに日付・出発港・方向・状態が全て入っており、本文は空。
// 例: 2026年9月6日（日） 鹿児島新港発 奄美群島経由 那覇港向け 下り便【臨時便・航行経路変更】
// 1記事＝1便なので、A"LINE のような本文の行解析は不要。

import { fetchFeed } from '../lib/rss.js';
import {
  extractDateUnits, extractDirection, extractOrigin, shortHash,
} from '../lib/text.js';
import { classify, detailLabel } from '../lib/status.js';

/** タイトル末尾の【...】を取り出す。状態判定はこの中だけを見る */
function extractBracket(title) {
  const m = title.match(/【([^】]+)】/);
  return m ? m[1] : null;
}

export async function watchMarix(source, { userAgent }) {
  const { items, fetchedAt } = await fetchFeed(source.url, { userAgent });

  const observations = items.map((item) => {
    const bracket = extractBracket(item.title);
    const statusText = bracket ?? item.title;
    const status = classify(statusText);
    const units = extractDateUnits(item.title, item.pubDate ?? fetchedAt);
    const direction = extractDirection(item.title);
    // 「◯◯発」より前に出る港名が出発港。「那覇港向け」の向け先と取り違えないよう、
    // タイトルの「発」までを対象にする。
    const beforeHatsu = item.title.split('発')[0] ?? item.title;
    const origin = extractOrigin(beforeHatsu);
    const detail = detailLabel(statusText, status);

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

    return {
      source_id: source.id,
      operator_id: source.operator_id,
      route_id: 'marix-main',
      ship: null, // タイトルに船名は含まれない
      status,
      detail,
      entries,
      service_dates: units.map((u) => u.from),
      title: item.title,
      link: item.link,
      guid: item.guid,
      published_at: item.pubDate,
      summary: item.title,
      body_hash: shortHash(item.title),
      confidence: 'A',
    };
  });

  return { fetchedAt, observations };
}
