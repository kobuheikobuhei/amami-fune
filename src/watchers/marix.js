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
import { fetchList } from './marix-list.js';

/** タイトル末尾の【...】を取り出す。状態判定はこの中だけを見る */
function extractBracket(title) {
  const m = title.match(/【([^】]+)】/);
  return m ? m[1] : null;
}


/**
 * 一覧ページの項目を、RSSと同じ形の観測結果へ変換する。
 * 一覧は状態が class として構造化されており、RSSより多くの便を載せる。
 */
async function fromList({ userAgent, known, source, details = {}, today }) {
  const { items, fetchedAt } = await fetchList({ userAgent });
  const observations = [];

  for (const it of items) {
    // 日付を取り出せない項目は扱わない。
    // 臨時便の一部はURLに日付を含まず、日付なしのまま渡すと
    // 終わりの無い案内として「継続中」に紛れ込む。
    if (!it.service_date) continue;

    // 個別ページは1枚1MBある。船名と条件付きの港だけを使うので、
    // 一度取ったら覚えておく。通常運航や過去の便は台帳に載らないため、
    // 覚えておかないと毎回取り直しになる（実測で1回10MB）。
    let ship = null;
    let portNotes = [];
    const cached = details[it.url];

    if (cached) {
      ship = cached.ship ?? null;
      portNotes = cached.port_notes ?? [];
    } else if (!today || it.service_date >= today) {
      // 過去の便は取りに行かない。もう表示に使わない。
      try {
        const d = await fetchDetail(it.url, { userAgent });
        ship = d.ship;
        portNotes = d.port_notes;
        details[it.url] = { ship: d.ship, port_notes: d.port_notes, date: it.service_date };
      } catch { /* 取れなくても一覧の情報で続ける */ }
    }
    const entries = it.service_date
      ? [{
          service_date: it.service_date,
          service_date_end: null,
          status: it.status,
          direction: it.direction ?? null,
          // 簡略な項目には出発港が載らない。この航路は下りが鹿児島新港発、
          // 上りが那覇港発と決まっているため方向から補う。
          origin: extractOrigin(it.ports?.[0] ?? "") ??
            (it.direction === "down" ? "鹿児島新港" : it.direction === "up" ? "那覇" : null),
          detail: it.label,
          specificity: 3,
          line: it.label,
        }]
      : [];

    observations.push({
      source_id: source.id,
      operator_id: source.operator_id,
      route_id: 'marix-main',
      ship,
      status: it.status,
      detail: it.label,
      entries,
      port_notes: portNotes,
      service_dates: it.service_date ? [it.service_date] : [],
      title: [it.service_date, it.direction === "up" ? "上り便" : it.direction === "down" ? "下り便" : null, it.label]
        .filter(Boolean).join(" "),
      link: it.url,
      guid: it.url,
      published_at: null,
      summary: it.label,
      body_hash: it.status + it.label,
      confidence: 'A',
    });
  }
  return { fetchedAt, observations };
}

async function fromRss(source, { userAgent, known = new Set() }) {
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


/**
 * マリックスラインの運航状況を取る。
 *
 * 一覧ページを主とする。状態が class として構造化されており、
 * RSSの10件に対して14便が載る。9月2日から5日の欠航はRSSに無かった。
 * 一覧が取れないときはRSSへ切り替える。
 */
export async function watchMarix(source, { userAgent, known = new Set(), details = {}, today = null }) {
  try {
    const r = await fromList({ userAgent, known, source, details, today });
    if (r.observations.length) return r;
  } catch {
    // 一覧の作りが変わった場合はRSSで続ける
  }
  return fromRss(source, { userAgent, known });
}