// 鹿児島発 下り便の配船を、両社の公式情報から組み立てる。
//
// マルエーフェリーは年間スケジュールのPDF、マリックスラインは
// 公式の検索。どちらも会社自身が出しているものだけを使う。
//
// 鹿児島発は1日1便を4隻で分け合う。両社を重ねて、同じ日に2隻が
// 出港していれば、どちらかの読み取りが壊れている。誤った予定を
// 載せるのは載せないより有害なので、壊れていれば何も出さない。

import { fetchSchedule as fetchMarueSchedule } from './marue.js';
import { fetchDates as fetchMarixDates } from '../watchers/marix-search.js';
import { jstDate } from '../lib/text.js';

const MARUE = { operator_id: 'marue', name: 'マルエーフェリー' };
const MARIX = { operator_id: 'marix', name: 'マリックスライン' };

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

/** マルエーの年間スケジュールから、鹿児島発の日を日付文字列で取り出す */
export function marueDepartureDates(schedule) {
  const out = [];
  for (const s of schedule) {
    for (const e of s.entries) {
      if (e.kind !== 'kagoshima') continue;
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
 * 両社を重ねて、日付ごとの鹿児島発を1本の並びにする。
 * 同じ日に2隻が出るのはありえないので、その日は問題として報告する。
 */
export function merge({ marue, marix, dates }) {
  const byDate = new Map(dates.map((d) => [d, []]));
  for (const d of [...marue, ...marix]) {
    if (byDate.has(d.date)) byDate.get(d.date).push(d);
  }

  const departures = [];
  const problems = [];
  const notes = [];

  for (const date of dates) {
    const ships = byDate.get(date);
    if (ships.length === 1) {
      departures.push(ships[0]);
    } else if (ships.length === 0) {
      notes.push(date + ' は両社とも鹿児島発の予定がありません');
    } else {
      problems.push(date + ' に複数の船が鹿児島を出港することになっています（' +
        ships.map((s) => s.ship).join('・') + '）');
    }
  }

  return { departures, problems, notes };
}

/**
 * 公式サイトから取り直す。相手先への負荷を避けるため、
 * 呼び出し側が間隔を決める（既定は1日1回）。
 */
export async function fetchFleet({ userAgent, now, back = 1, ahead = 7 }) {
  const today = jstDate(now);
  const dates = windowDates(today, back, ahead);

  const marueResult = await fetchMarueSchedule({ userAgent });
  const marue = marueDepartureDates(marueResult.schedule).filter((d) => dates.includes(d.date));

  const marixRaw = await fetchMarixDates(dates, { userAgent });
  const marix = marixRaw.map((r) => ({ date: r.date, ship: r.ship, depart: r.depart, ...MARIX }));

  const merged = merge({ marue, marix, dates });

  return {
    checked_at: now,
    from: dates[0],
    to: dates[dates.length - 1],
    sources: { marue: marueResult.url, marix: 'https://marixline.com/price_schedule/' },
    ...merged,
  };
}

/** 取り直すべきかを決める。既定は12時間ごと、または窓が明日に届かないとき */
export function shouldRefresh(previous, now, { hours = 12 } = {}) {
  if (!previous?.checked_at || !previous.departures) return true;
  const tomorrow = addDays(jstDate(now), 1);
  if (!previous.to || previous.to < tomorrow) return true;
  return (new Date(now) - new Date(previous.checked_at)) / 36e5 >= hours;
}
