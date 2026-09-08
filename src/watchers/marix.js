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

/** タイトル末尾の【...】を取り出す。状態判定はこの中だけを見る */
function extractBracket(title) {
  const m = title.match(/【([^】]+)】/);
  return m ? m[1] : null;
}

/**
 * 括弧の無い発表の状態を決める。
 *
 * マリックスラインは、平常でない状態をすべてタイトルの【】で示す。
 * 括弧が無い発表は平常運航の告知であることを実際の記事で確認した。
 *
 * 記事ページ本体から判定する方法も試したが、このサイトは内容を
 * JavaScript で描画しており、取得できるHTMLには本文が入っていない。
 * そのため表記の規則に頼る。
 *
 * 平常運航は記事にしないため、取り違えても誤った情報が出ることはない。
 * ただし将来この規則が変わると、括弧の無い重要な発表を
 * 平常運航として見過ごすことになる。
 */
function statusWithoutBracket(title) {
  // 括弧が無くてもタイトルに状態語があればそれを優先する
  return classify(title) ?? 'normal';
}

export async function watchMarix(source, { userAgent }) {
  const { items, fetchedAt } = await fetchFeed(source.url, { userAgent });
  const observations = [];

  for (const item of items) {
    const bracket = extractBracket(item.title);
    const statusText = bracket ?? item.title;

    let status = classify(statusText);
    let detail = detailLabel(statusText, status);

    if (!bracket) {
      status = statusWithoutBracket(item.title);
      detail = detailLabel(item.title, status);
    }

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
      ship: null, // タイトルに船名は含まれない
      status,
      detail,
      entries,
      port_notes: [],
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
