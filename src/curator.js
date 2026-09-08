// 差分検出とイベント化。
//
// 速報ブログの品質はここで決まる。守るべき性質は3つ。
//   1. 同じ欠航を二度投稿しない
//   2. 状態が変わったとき（欠航→運航再開など）は同じ記事の続報として扱う
//   3. 初回実行時に過去の記事をまとめて投稿しない

import { AUTO_PUBLISHABLE, NOT_ARTICLE } from './lib/status.js';
import { jstDate } from './lib/text.js';

// 発表日時の古さでは足切りしない。
// A"LINE は既存の記事を書き換えて新しい便の案内を載せるが、
// RSS の発表日時は最初に作られたときのまま更新されない。
// 8月28日付の記事に9月8日の便の案内が入る、ということが実際に起きる。
// 古い情報を掘り起こさないための歯止めは、運航日そのもので判断する。

/** 便を一意に識別する鍵。状態はここに含めない（状態は時間とともに変わるため） */
/**
 * 便を一意に識別する鍵。状態はここに含めない（状態は時間とともに変わるため）。
 *
 * ただし臨時便は定期便とは別の便なので分ける。
 * 「9月7日の上り便が欠航」と「同じ日に上り臨時便を出す」は同時に成り立つ事実であり、
 * 同じ便として扱うと片方が消えてしまう。
 */
export function eventKey(entry, routeId) {
  const period =
    entry.service_date_end && entry.service_date_end !== entry.service_date
      ? entry.service_date + '_' + entry.service_date_end
      : entry.service_date;
  const kind = /臨時/.test(entry.detail ?? '') || /臨時/.test(entry.line ?? '') ? 'rinji' : 'teiki';
  return [routeId, period, entry.origin ?? '-', entry.direction ?? '-', kind].join('|');
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


      // 昨日より前に終わった運航日は、今さら知らせても意味がないので投稿しない。
      // 期間の場合は終わりの日で判断する（ドック期間の途中で始めても掲載されるように）。
      const publishedAt = obs.published_at ?? now;

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

    // 台帳にはあるが記事が無いものは、投稿に失敗したまま取り残されている。
    // 放置すると二度と投稿されないため、次の実行で作り直す。
    if (!prev.published_post) {
      actions.push({
        type: seeding ? 'seed' : 'create',
        candidate: c,
        event: { ...prev, ...c, revisions: prev.revisions ?? [] },
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


/**
 * 継続中のお知らせを取り出す。
 *
 * 「機関故障により当面の間運休」のような案内は、開始日が過去のため
 * 便ごとのイベントとしては足切りされて消える。しかし公式が今も掲載している以上、
 * それは現在も続いている状態であり、読者にとっては個別の欠航より影響が大きい。
 *
 * 公式のフィードに今も載っていて、かつ今日以降の便を持たない案内を
 * 「継続中」として扱う。
 */
// 終わりを定めずに続く状態を示す言い回し。
// 「当面の間」「復旧まで」のように、いつ戻るか決まっていない案内を見分ける。
const OPEN_ENDED = /当面|当分|復旧|再開まで|別途|未定|見込み|しばらく/;

/**
 * 継続中のお知らせを取り出す。
 *
 * 「機関故障により当面の間運休」のような案内は、開始日が過去のため
 * 便ごとのイベントとしては足切りされて消える。しかし公式が今も掲載している以上、
 * それは現在も続いている状態であり、読者にとっては個別の欠航より影響が大きい。
 *
 * ただし「9月3日の便が欠航」のような、日付が過ぎて終わった案内まで
 * 継続中として見せてはならない。古い情報を現在の状態として示すことになる。
 *
 * そこで、今日以降の便を持たない案内のうち、
 *   ・そもそも日付を伴わない（体制の変更など）
 *   ・終わりを定めない言い回しを含む（当面の間、復旧まで）
 * のいずれかに当てはまるものだけを継続中として扱う。
 */
export function ongoingNotices(observations, { now }) {
  const today = jstDate(now);
  const notices = [];

  for (const obs of observations) {
    if (!obs.status || NOT_ARTICLE.has(obs.status)) continue;

    const entries = obs.entries ?? [];
    const hasFuture = entries.some((e) => (e.service_date_end ?? e.service_date) >= today);
    if (hasFuture) continue;

    const openEnded = OPEN_ENDED.test(obs.summary ?? "") || OPEN_ENDED.test(obs.title ?? "");
    const undated = entries.length === 0;
    if (!openEnded && !undated) continue; // 日付が過ぎて終わった案内

    notices.push({
      route_id: obs.route_id,
      ship: obs.ship,
      status: obs.status,
      detail: obs.detail,
      title: obs.title,
      source_url: obs.link,
      since: entries[0]?.service_date ?? null,
      published_at: obs.published_at,
    });
  }
  return notices;
}

/**
 * 船ごとに、いま有効な案内を1つだけ選ぶ。
 *
 * 各社は船ごとの掲示を並べて置いており、古いものも残る。
 * 同じ船に「ドック入り（9月2日発表）」と「通常運航（4月10日発表）」が
 * 同時に載っている状態が実際にある。船ごとに最新のものを採る。
 *
 * ただし新しければよいわけではない。対象の日が過ぎた案内は、
 * 新しくても現在を表さない。ドックが明けた後もドック入りと
 * 言い続けることになるため、期間の終わった案内は選ばない。
 *
 * 「当面の間」のように終わりを定めない案内は、日付が過去でも
 * 続いているため期限切れとしない。
 */
export function latestByShip(observations, { now }) {
  const today = jstDate(now);

  const expired = (obs) => {
    const entries = obs.entries ?? [];
    if (!entries.length) return false; // 日付を伴わない掲示は期限切れにしない
    if (OPEN_ENDED.test(obs.summary ?? '') || OPEN_ENDED.test(obs.title ?? '')) return false;
    return entries.every((e) => (e.service_date_end ?? e.service_date) < today);
  };

  const best = new Map();
  for (const obs of observations) {
    if (!obs.ship || !obs.status) continue;
    if (expired(obs)) continue;

    const key = obs.route_id + '|' + obs.ship;
    const prev = best.get(key);
    if (!prev || new Date(obs.published_at ?? 0) > new Date(prev.published_at ?? 0)) {
      best.set(key, obs);
    }
  }
  return [...best.values()];
}

/**
 * 公式が通常運航と掲げている船。
 * ある船がドック入りでも別の船が動いていることを、読者に伝えるために使う。
 */
export function normalShips(observations, { now }) {
  return latestByShip(observations, { now })
    .filter((obs) => obs.status === 'normal')
    .map((obs) => ({
      route_id: obs.route_id,
      ship: obs.ship,
      source_url: obs.link,
      published_at: obs.published_at,
    }));
}