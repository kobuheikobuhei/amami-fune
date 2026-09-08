// 2社の配船を突き合わせて、解析が壊れていないか確かめる。
//
// PDFの解析はレイアウトが変われば静かに壊れ、もっともらしい数字を
// 出し続ける。誤った「本来の予定」を示すのは、示さないより有害。
//
// 鹿児島発は原則として毎日1便という性質を使う。マルエーとマリックスの
// 出港日を重ねたとき、同じ日に2隻が出港していれば、どちらかの解析で
// 列がずれている。

/** マルエーの解析結果から、月ごとの鹿児島発の日を取り出す */
export function marueDepartures(schedule, year, month) {
  const days = new Map();
  for (const s of schedule) {
    if (s.year !== year || s.month !== month) continue;
    for (const e of s.entries) {
      if (e.kind !== 'kagoshima') continue;
      if (!days.has(e.day)) days.set(e.day, []);
      days.get(e.day).push(s.ship);
    }
  }
  return days;
}

/** マリックスの解析結果から、月ごとの出港日を取り出す */
export function marixDepartures(schedule, year, month) {
  const days = new Map();
  for (const s of schedule) {
    if (s.year !== year || s.month !== month) continue;
    for (const d of s.days) {
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(s.ship);
    }
  }
  return days;
}

/**
 * 2社を重ねて矛盾を探す。
 *
 * 解析が壊れると列が丸ごとずれ、「重複」と「空き」が同時に大量に出る。
 * 一方、ドックの端境期には本当に出港のない日が1日だけ生じることがあり、
 * そのときは2社の資料が揃って空きを示す。両者を区別する。
 *
 * problems が空なら解析は健全。notes は実際に出港のない日。
 */
export function crossCheck({ marue, marix, year, month }) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const a = marueDepartures(marue, year, month);
  const b = marixDepartures(marix, year, month);
  const problems = [];
  const notes = [];

  const empty = [];
  const doubled = [];

  for (let d = 1; d <= lastDay; d++) {
    const ships = [...(a.get(d) ?? []), ...(b.get(d) ?? [])];
    if (ships.length === 0) empty.push(d);
    if (ships.length > 1) doubled.push(d + '日(' + ships.join('・') + ')');
  }

  const label = year + '年' + month + '月';

  // 同じ日に2隻というのは、どちらの資料にも本来ありえない。必ず解析の異常。
  if (doubled.length) {
    problems.push(label + ': 同じ日に複数の船が鹿児島を出港します（' + doubled.join('、') + '）');
  }

  // 空きが月に何日もあるのは、列がずれた兆候。1日だけなら実際の運休日。
  if (empty.length > 1) {
    problems.push(label + ': 鹿児島を出港しない日が' + empty.length + '日あります（' + empty.join(',') + '日）');
  } else if (empty.length === 1) {
    notes.push(label + empty[0] + '日: 両社とも出港の予定がありません（ドックの端境期とみられます）');
  }

  return { problems, notes };
}

/** 年度分をまとめて検査する */
export function crossCheckAll({ marue, marix }) {
  const keys = [...new Set([...marue, ...marix].map((s) => s.year * 100 + s.month))].sort();
  const problems = [];
  const notes = [];
  for (const key of keys) {
    const r = crossCheck({ marue, marix, year: Math.floor(key / 100), month: key % 100 });
    problems.push(...r.problems);
    notes.push(...r.notes);
  }
  return { months: keys.length, problems, notes };
}

/** その日に鹿児島を出港する船を返す。両社を合わせて1隻になるはず */
export function shipOnDate({ marue, marix, year, month, day }) {
  const a = marueDepartures(marue, year, month).get(day) ?? [];
  const b = marixDepartures(marix, year, month).get(day) ?? [];
  const ships = [...a, ...b];
  if (ships.length !== 1) return null; // 判然としないときは示さない
  return { ship: ships[0], operator: a.length ? 'marue' : 'marix' };
}
