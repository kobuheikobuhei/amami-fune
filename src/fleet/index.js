// 鹿児島〜奄美群島〜沖縄の配船を、両社の公式情報から組み立てる。
//
// マルエーフェリーは年間スケジュールのPDF、マリックスラインは
// 公式の検索。どちらも会社自身が出しているものだけを使う。
//
// 下り（鹿児島発）も上り（那覇発）も1日1便を4隻で分け合う。
// 両社を重ねて、同じ日に2隻が出港していれば読み取りが壊れている。
// 誤った予定を載せるのは載せないより有害なので、そのときは何も出さない。

import { fetchSchedule as fetchMarueSchedule } from './marue.js';
import { fetchDates as fetchMarixDates } from '../watchers/marix-search.js';
import { jstDate } from '../lib/text.js';

const MARUE = { operator_id: 'marue', name: 'マルエーフェリー' };
const MARIX = { operator_id: 'marix', name: 'マリックスライン' };

// マルエーの記号と向きの対応。●が鹿児島発、○が那覇発。
const KIND_BY_DIRECTION = { down: 'kagoshima', up: 'naha' };

// マリックスの検索に送る区間。
const SEGMENT_BY_DIRECTION = {
  down: { from: 'kagoshima', to: 'naha' },
  up: { from: 'naha', to: 'kagoshima' },
};

const ORIGIN_BY_DIRECTION = { down: '鹿児島', up: '那覇' };

/** 日付文字列をずらす */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 前後の日付を並べる */
export function windowDates(today, back, ahead) {
  const out = [];
  for (let i = -back; i <= ahead; i++) out.push(addDays(today, i));
  return out;
}

/** マルエーの年間スケジュールから、その向きの出港日を日付文字列で取り出す */
export function marueDepartureDates(schedule, direction) {
  const kind = KIND_BY_DIRECTION[direction];
  const out = [];
  for (const s of schedule) {
    for (const e of s.entries) {
      if (e.kind !== kind) continue;
      out.push({
        date: [s.year, String(s.month).padStart(2, '0'), String(e.day).padStart(2, '0')].join('-'),
        ship: s.ship,
        ...MARUE,
      });
    }
  }
  return out;
}

/**
 * 両社を重ねて、日付ごとの出港を1本の並びにする。
 * 同じ日に2隻が出るのはありえないので、その日は問題として報告する。
 */
export function merge({ marue, marix, dates, direction }) {
  const byDate = new Map(dates.map((d) => [d, []]));
  for (const d of [...marue, ...marix]) {
    if (byDate.has(d.date)) byDate.get(d.date).push(d);
  }

  const origin = ORIGIN_BY_DIRECTION[direction] ?? '';
  const departures = [];
  const problems = [];
  const notes = [];

  for (const date of dates) {
    const ships = byDate.get(date);
    if (ships.length === 1) {
      departures.push({ ...ships[0], direction });
    } else if (ships.length === 0) {
      notes.push(date + ' は両社とも' + origin + '発の予定がありません');
    } else {
      problems.push(date + ' に複数の船が' + origin + 'を出港することになっています（' +
        ships.map((s) => s.ship).join('・') + '）');
    }
  }

  return { departures, problems, notes };
}

/**
 * 公式サイトから取り直す。相手先への負荷を避けるため、
 * 呼び出し側が間隔を決める（既定は12時間ごと）。
 *
 * マルエーのPDFは1回だけ取り、両方向をそこから読む。
 * マリックスは日付ごとの問い合わせなので、向きごとに日数分だけ呼ぶ。
 */
export async function fetchFleet({ userAgent, now, back = 1, ahead = 7 }) {
  const today = jstDate(now);
  const dates = windowDates(today, back, ahead);

  const marueResult = await fetchMarueSchedule({ userAgent });

  const departures = {};
  const problems = [];
  const notes = [];

  for (const direction of ['down', 'up']) {
    const marue = marueDepartureDates(marueResult.schedule, direction)
      .filter((d) => dates.includes(d.date));

    const raw = await fetchMarixDates(dates, { userAgent, ...SEGMENT_BY_DIRECTION[direction] });
    const marix = raw.map((r) => ({ date: r.date, ship: r.ship, depart: r.depart, ...MARIX }));

    const merged = merge({ marue, marix, dates, direction });
    departures[direction] = merged.departures;
    problems.push(...merged.problems);
    notes.push(...merged.notes);
  }

  problems.push(...checkCycle(departures));

  return {
    checked_at: now,
    from: dates[0],
    to: dates[dates.length - 1],
    sources: { marue: marueResult.url, marix: 'https://marixline.com/price_schedule/' },
    departures,
    problems,
    notes,
  };
}

/**
 * 下りと上りのつながりを確かめる。
 *
 * 1隻の周期は決まっている。鹿児島をD日18:00に出て、翌日19:00に那覇へ着き、
 * D+2日07:00に那覇を出て、D+3日08:30に鹿児島へ戻る。
 * つまり、ある日の下りの船は、その2日後の上りの船と同じでなければならない。
 *
 * 下りと上りは別々に読み取っているので、この関係が崩れていれば
 * どちらかが壊れている。2つの読み取りを互いの検算に使える。
 */
export function checkCycle(departures) {
  const up = new Map((departures.up ?? []).map((d) => [d.date, d]));
  const problems = [];

  for (const d of departures.down ?? []) {
    const expected = up.get(addDays(d.date, 2));
    if (!expected) continue; // 窓の外。判断しない
    if (expected.ship !== d.ship) {
      problems.push(d.date + 'の下りは' + d.ship + 'ですが、2日後の上りが' + expected.ship + 'になっています');
    }
  }
  return problems;
}
/** 取り直すべきかを決める。既定は12時間ごと、または窓が明日に届かないとき */
export function shouldRefresh(previous, now, { hours = 12 } = {}) {
  if (!previous?.checked_at) return true;
  // 形が変わったときも取り直す（下り・上りに分ける前の記録が残っている場合）
  if (!previous.departures || Array.isArray(previous.departures)) return true;
  if (!previous.departures.down || !previous.departures.up) return true;
  const tomorrow = addDays(jstDate(now), 1);
  if (!previous.to || previous.to < tomorrow) return true;
  return (new Date(now) - new Date(previous.checked_at)) / 36e5 >= hours;
}
