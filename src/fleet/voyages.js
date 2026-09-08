// 配船と時刻表から、いま航行している便と次に出る便を組み立てる。
//
// 「どの船が動いているか」は、船の入渠と便の運休を読者が取り違えない
// ための土台になる。ドック入りの船があっても、別の船が同じ便を担う。
//
// 時刻は公式の時刻表そのままで、推測は入れない。

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
