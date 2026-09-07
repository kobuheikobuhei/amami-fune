// 差分検出とイベント化。
//
// 速報ブログの品質はここで決まる。守るべき性質は3つ。
//   1. 同じ欠航を二度投稿しない
//   2. 状態が変わったとき（欠航→運航再開など）は同じ記事の続報として扱う
//   3. 初回実行時に過去の記事をまとめて投稿しない

import { AUTO_PUBLISHABLE, NOT_ARTICLE } from './lib/status.js';

// 記事より古い情報は投稿しない。初回実行や長期停止からの復帰で
// 過去の案内を一斉に掘り起こさないための保険。
const ARTICLE_MAX_AGE_DAYS = 7;

/** 便を一意に識別する鍵。状態はここに含めない（状態は時間とともに変わるため） */
export function eventKey(entry, routeId) {
  const period =
    entry.service_date_end && entry.service_date_end !== entry.service_date
      ? entry.service_date + '_' + entry.service_date_end
      : entry.service_date;
  return [routeId, period, entry.origin ?? '-', entry.direction ?? '-'].join('|');
}

function daysBetween(a, b) {
  return (new Date(a) - new Date(b)) / 86400000;
}

/**
 * 観測結果を候補イベントへ変換する。
 * 同じ鍵に複数の候補があれば、公開日時が新しいものを採る（＝続報が古い情報に勝つ）。
 */
export function toCandidates(observations, { now }) {
  const byKey = new Map();

  for (const obs of observations) {
    for (const entry of obs.entries ?? []) {
      if (!entry.status || NOT_ARTICLE.has(entry.status)) continue;

      const publishedAt = obs.published_at ?? now;
      if (daysBetween(now, publishedAt) > ARTICLE_MAX_AGE_DAYS) continue;

      // 昨日より前に終わった運航日は、今さら知らせても意味がないので投稿しない。
      // 期間の場合は終わりの日で判断する（ドック期間の途中で始めても掲載されるように）。
      const lastDay = entry.service_date_end ?? entry.service_date;
      if (daysBetween(now, lastDay + 'T23:59:59Z') > 1) continue;

      // 同じ発表に含まれる他の便。読者が「いつ戻るのか」を追加の記事を探さずに
      // 把握できるよう、記事に併記するために持ち回る。
      const related = (obs.entries ?? [])
        .filter((o) => o !== entry)
        .map((o) => ({
          service_date: o.service_date,
          service_date_end: o.service_date_end ?? null,
          status: o.status,
          detail: o.detail,
          origin: o.origin,
          direction: o.direction,
        }));

      const key = eventKey(entry, obs.route_id);
      const candidate = {
        related,
        port_notes: obs.port_notes ?? [],
        event_key: key,
        route_id: obs.route_id,
        operator_id: obs.operator_id,
        ship: obs.ship,
        service_date: entry.service_date,
        service_date_end: entry.service_date_end ?? null,
        direction: entry.direction,
        origin: entry.origin,
        status: entry.status,
        detail: entry.detail,
        evidence: entry.line,
        source_id: obs.source_id,
        source_url: obs.link,
        source_title: obs.title,
        published_at: publishedAt,
        confidence: obs.confidence ?? 'A',
      };

      const prev = byKey.get(key);
      if (!prev || new Date(candidate.published_at) >= new Date(prev.published_at)) {
        byKey.set(key, candidate);
      }
    }
  }

  return [...byKey.values()];
}

/**
 * 台帳と突き合わせて、新規・続報・変化なしに振り分ける。
 * seedOnly は初回実行時に真になり、台帳には記録するが投稿はしない。
 */
export function diffAgainstLedger(candidates, ledger, { seedOnlySources = new Set(), now }) {
  const actions = [];

  for (const c of candidates) {
    const seeding = seedOnlySources.has(c.source_id);
    const prev = ledger.get(c.event_key);

    if (!prev) {
      actions.push({
        type: seeding ? 'seed' : 'create',
        candidate: c,
        event: {
          ...c,
          detected_at: now,
          confirmed_at: now, // 公式が根拠のため検知と同時に確定する
          published_post: null,
          revisions: [
            { at: now, status: c.status, detail: c.detail, source_url: c.source_url },
          ],
        },
      });
      continue;
    }

    const statusChanged = prev.status !== c.status;
    const sourceChanged = prev.source_url !== c.source_url;
    const newer = new Date(c.published_at) > new Date(prev.published_at ?? 0);

    if ((statusChanged || sourceChanged) && newer) {
      actions.push({
        type: seeding ? 'seed' : 'update',
        candidate: c,
        event: {
          ...prev,
          status: c.status,
          detail: c.detail,
          evidence: c.evidence,
          source_url: c.source_url,
          source_title: c.source_title,
          published_at: c.published_at,
          confirmed_at: now,
          revisions: [
            ...(prev.revisions ?? []),
            { at: now, status: c.status, detail: c.detail, source_url: c.source_url },
          ],
        },
      });
    } else {
      actions.push({ type: 'none', candidate: c, event: prev });
    }
  }

  return actions;
}

/** 自動公開してよいか（仕様Q28）。判断を要するものは下書きに回す */
export function publishDecision(event) {
  if (event.confidence !== 'A') return 'draft';
  return AUTO_PUBLISHABLE.has(event.status) ? 'publish' : 'draft';
}
