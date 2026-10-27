// 配船と時刻表から、いま航行している便と次に出る便を組み立てる。
//
// 「どの船が動いているか」は、船の入渠と便の運休を読者が取り違えない
// ための土台になる。ドック入りの船があっても、別の船が同じ便を担う。
//
// 時刻は公式の時刻表そのままで、推測は入れない。

import { STATUS } from '../lib/status.js';

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** JSTの日付と時刻から、実時刻を作る */
export function jstMoment(dateStr, time) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JST_OFFSET_MS);
}

function shiftDate(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 出港日と時刻表から1便を組み立てる。
 * 寄港地ごとに、その日付と時刻を持たせる。
 */
export function buildVoyage(departure, timetable) {
  const stops = timetable.stops.map((s) => {
    const date = shiftDate(departure.date, (s.day ?? 1) - 1);
    return {
      port: s.port,
      area: s.area ?? null,
      date,
      arrive: s.arrive ?? null,
      depart: s.depart ?? null,
      arriveAt: s.arrive ? jstMoment(date, s.arrive).toISOString() : null,
      departAt: s.depart ? jstMoment(date, s.depart).toISOString() : null,
    };
  });

  const first = stops[0];
  const last = stops[stops.length - 1];

  return {
    ...departure,
    label: timetable.label,
    stops,
    departAt: first.departAt,
    arriveAt: last.arriveAt,
  };
}

/** 出港日の並びから、便の並びを作る */
export function buildVoyages(departures, timetable) {
  return departures
    .map((d) => buildVoyage(d, timetable))
    .sort((a, b) => a.departAt.localeCompare(b.departAt));
}

/**
 * いま航行している便。出港済みで、終点にまだ着いていないもの。
 * 便は25時間かかり毎日出るため、重なる時間帯がある。出港が早い順に返す。
 */
export function sailingNow(voyages, now) {
  const t = new Date(now).toISOString();
  return voyages.filter((v) => v.departAt <= t && t < v.arriveAt);
}

/** 次に出る便 */
export function nextDeparture(voyages, now) {
  const t = new Date(now).toISOString();
  return voyages.find((v) => v.departAt > t) ?? null;
}

/** その便が今どこにいるか。直前に出た港と、次に着く港を返す */
export function progress(voyage, now) {
  const t = new Date(now).toISOString();
  let last = null;
  let next = null;
  for (const s of voyage.stops) {
    if (s.departAt && s.departAt <= t) last = s;
    else if (s.arriveAt && s.arriveAt > t) { next = s; break; }
  }
  // 終点だけは出港時刻を持たない
  if (!next && voyage.arriveAt > t) next = voyage.stops[voyage.stops.length - 1];
  return { last, next };
}

/**
 * 欠航で配船予定から消えた便を、台帳から補う。
 *
 * マリックスラインの公式検索は、欠航した日の時刻表を返さない。会社として
 * 「その日は運航しない」が正しい答えなのだが、こちらの配船予定からも便
 * そのものが消えるため、「現在の運航」は次の定期便へ飛んでしまう。
 * 10月28日の下り便（クイーンコーラルクロス 欠航）がどこにも出ず、次の
 * 出港が10月29日になっていた。読者には便の無い日と見える。
 *
 * 載っていないのが欠航なのか載せ忘れなのか、読者に区別がつかないのが
 * この画面でいちばん困る。欠航の発表があるなら、欠航として出す。
 *
 * 使うのは会社自身の欠航の発表（台帳）と、会社自身の時刻表だけ。推測は
 * 入れない。問い合わせた期間（fleet.from〜fleet.to）の内側にとどめる。
 * その外は、そもそも配船が分かっていない。
 *
 * 同じ日に便を二重に作らない。この航路はどの向きも1日1便で、すでに
 * 予定が入っている日は、札が欠航に変わるだけでよい。
 */
function cancelledDepartures({ timetable, departures, events, routes, from, to }) {
  const routeIds = new Set(timetable.route_ids ?? []);
  if (!routeIds.size || !from || !to) return [];

  // 会社名は配船予定と同じ表記にそろえる。航路の short がその表記。
  const shortById = new Map(routes.map((r) => [r.id, r.short]));
  const taken = new Set(departures.map((d) => d.date));
  const out = [];

  for (const e of events) {
    if (e.status !== STATUS.CANCELLED) continue;
    if (!routeIds.has(e.route_id)) continue;
    if (e.direction !== timetable.direction) continue;
    if (!e.ship || !e.service_date) continue;
    if (e.service_date < from || e.service_date > to) continue;
    if (taken.has(e.service_date)) continue;

    const name = shortById.get(e.route_id);
    if (!name || !e.operator_id) continue;

    taken.add(e.service_date);
    out.push({
      date: e.service_date,
      ship: e.ship,
      operator_id: e.operator_id,
      name,
      direction: timetable.direction,
      // 配船予定から来た便と区別できるようにしておく。
      from_notice: true,
    });
  }
  return out;
}

/**
 * 取得した配船と時刻表から、表示に渡す形を作る。
 *
 * 航路ごとにまとめ、その中を下り・上りに分ける。時刻表の名前を鍵にして
 * 対応づけるので、航路が増えても data/timetable.yml に足すだけで済む。
 */
export function buildFleetView(fleet, timetables, { events = [], routes = [] } = {}) {
  const groups = new Map();

  for (const [key, timetable] of Object.entries(timetables)) {
    const departures = fleet?.departures?.[key] ?? [];
    // 配船予定がまるごと届いていない向きは、欠航の発表だけで便を作らない。
    // その向きの配船が分かっていないのに、分かっているように見せてしまう。
    if (!departures.length) continue;

    const all = [...departures, ...cancelledDepartures({
      timetable, departures, events, routes, from: fleet?.from, to: fleet?.to,
    })];

    const name = timetable.group ?? timetable.label;
    if (!groups.has(name)) {
      groups.set(name, {
        group: name,
        operators: timetable.operators ?? null,
        note: timetable.note ?? null,
        services: [],
        links: [],
      });
    }
    const g = groups.get(name);
    if (!g.note && timetable.note) g.note = timetable.note;
    g.services.push({
      key,
      label: timetable.label,
      summary: timetable.summary,
      voyages: buildVoyages(all, timetable),
    });
    for (const s of timetable.sources ?? []) {
      if (!g.links.some((l) => l.url === s.url)) g.links.push(s);
    }
  }

  const built = [...groups.values()];
  if (!built.length) return null;
  return { ...fleet, routes: built };
}

/** 表示に出ている運航会社。案内の書き方を変えるのに使う */
export function fleetOperatorIds(view) {
  return new Set((view?.routes ?? [])
    .flatMap((r) => r.services)
    .flatMap((s) => s.voyages.map((v) => v.operator_id)));
}
