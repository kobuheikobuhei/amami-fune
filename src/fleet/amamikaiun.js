// 奄美海運の運航スケジュールを読み取る。
//
// この航路は鹿児島航路と事情が違う。相手が1社しかなく、会社どうしの
// 突き合わせができない。代わりに、公式の案内が前提どおりかを毎回確かめる。
//
// 体制はときどき入れ替わる。令和8年5月から10月はフェリーあまみが機関故障で
// 運休し、フェリーきかいが週3便で走っていた。11月2日に2隻・週4便へ戻った。
//
// 公式ページには新旧の案内が並んで置かれる。古い方も「週3便」の語を持つので、
// 語で選ぶと期限切れの案内を読み続けてしまう。実際、切り替えの前日まで
// 週3便の案内を読んでいた（2026-11-01に発見）。選ぶのは適用期間で決める。
// 期間はリンクの文字そのものに書かれている（「◯月◯日から」「◯月◯日まで」）。
//
// どの曜日にどちらの船が出るかは、案内のPDFに載っていない。お知らせの本文に
// しかないため、data/timetable.yml に書き写して持つ。4ヶ月ごとに下り・上りの
// 船が入れ替わる決まりなので、入替の予定日も持ち、近づいたら点検で知らせる。
//
// 出典: 奄美海運株式会社（A"LINE）

import { fetchText, fetchBytes } from '../lib/fetcher.js';
import { extractItems, toPlainText } from './pdftext.js';

const PAGE = 'https://www.aline-ferry.com/amami/time/';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const weekdayOf = (date) => WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
const sortDays = (days) => [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));

/** リンクの文字に書かれた「◯年◯月◯日から／まで」を日付に直す */
function dateIn(text, suffix) {
  const m = text.match(new RegExp('([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日' + suffix));
  if (!m) return null;
  return [m[1], m[2].padStart(2, '0'), m[3].padStart(2, '0')].join('-');
}

/** ページに並ぶ運航スケジュールの案内を、適用期間つきで拾う */
export function parseScheduleLinks(html) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    if (!/運航スケジュール/.test(text)) continue;
    // 「（ヨコ）」は同じ内容の図表版。
    if (text.includes('ヨコ')) continue;
    out.push({ url: m[1], text, from: dateIn(text, 'から'), to: dateIn(text, 'まで') });
  }
  return out;
}

/**
 * その日に使う案内を選ぶ。
 *
 * 期間の内側にあるものを採る。切り替えをまたぐ数日は、どれにも入らない
 * ことがある（旧が「10月30日まで」、新が「11月2日から」のような隙間）。
 * そのときは次に始まる案内を採り、その案内が受け持つ日付だけに使う。
 * 期限切れの方を使い回すと、明日からの予定を静かに間違える。
 */
export function pickSchedule(links, today) {
  const inForce = links.filter((l) => (!l.from || l.from <= today) && (!l.to || today <= l.to));
  if (inForce.length) {
    return inForce.sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''))[0];
  }
  const upcoming = links.filter((l) => l.from && l.from > today)
    .sort((a, b) => a.from.localeCompare(b.from));
  return upcoming[0] ?? null;
}

/**
 * 案内から、下り・上りそれぞれの運航日（曜日）を読み取る。
 *
 * 表には1日目と2日目の曜日が並ぶ。出港する日は1日目なので、
 * 「運航日」の後に最初に現れる曜日の並びを採る。
 */
export function parseRunDays(text) {
  const out = {};
  for (const [key, head] of [['down', '【下り便】'], ['up', '【上り便】']]) {
    const i = text.indexOf(head);
    if (i < 0) continue;
    const next = text.indexOf('【', i + 1);
    const segment = next < 0 ? text.slice(i) : text.slice(i, next);
    const j = segment.indexOf('運航日');
    if (j < 0) continue;
    const m = segment.slice(j).match(/[日月火水木金土](?:・[日月火水木金土])+/);
    if (m) out[key] = m[0].split('・');
  }
  return out;
}

/** 公式ページから、その日に使う案内を取る */
export async function fetchNotice({ userAgent, today }) {
  const { body } = await fetchText(PAGE, { userAgent });
  const links = parseScheduleLinks(body);
  if (!links.length) throw new Error('運航スケジュールの案内が見つかりません');

  const picked = pickSchedule(links, today);
  if (!picked) throw new Error('この日に当てはまる運航スケジュールの案内がありません');

  const { bytes } = await fetchBytes(picked.url, { userAgent });
  const pages = await extractItems(bytes);
  const text = pages.map((p) => toPlainText(p)).join('\n');

  return { ...picked, text, weekdays: parseRunDays(text) };
}

/**
 * 時刻の表記をそろえる。
 *
 * 案内のPDFは全角と半角が混ざる。週3便の案内は数字もコロンも全角だったが、
 * 週4便の案内は「04：30」と半角の数字に全角のコロンだった。全角に寄せて
 * 突き合わせていたため、時刻16件すべてが「案内に見当たりません」になった。
 * どちらの書き方でも照らせるよう、半角に寄せてから見る。
 */
const toNarrow = (s) => s
  .replace(/[０-９]/g, (c) => '０１２３４５６７８９'.indexOf(c))
  .replace(/：/g, ':');

/**
 * 案内が、持っている前提どおりかを確かめる。
 * 外れていれば体制が変わったということなので、表示してはいけない。
 */
export function verify(notice, timetables) {
  const problems = [];
  const plain = toNarrow(notice.text.replace(/\s/g, ''));

  for (const key of ['down', 'up']) {
    const t = timetables[key];
    const fleet = t.fleet ?? [];
    if (!fleet.length) {
      problems.push(t.label + 'の運航船舶が設定されていません');
      continue;
    }

    // 運航日が案内と一致しているか
    const ours = sortDays(new Set(fleet.flatMap((f) => f.weekdays)));
    const theirs = notice.weekdays?.[key];
    if (!theirs?.length) {
      problems.push(t.label + 'の運航日を案内から読み取れませんでした');
    } else if (sortDays(theirs).join('・') !== ours.join('・')) {
      problems.push(t.label + 'の運航日が変わっています（案内: ' +
        sortDays(theirs).join('・') + ' / 掲載: ' + ours.join('・') + '）');
    }

    // 同じ曜日に2隻を割り当てていないか（書き写しの誤り）
    const seen = new Set();
    for (const f of fleet) {
      for (const d of f.weekdays) {
        if (seen.has(d)) problems.push(t.label + 'の' + d + '曜に2隻が割り当てられています');
        seen.add(d);
      }
    }

    // 船名が案内に出ているか
    for (const f of fleet) {
      if (!plain.includes(f.ship)) problems.push(f.ship + 'が案内に見当たりません');
    }

    // 時刻がひとつでも案内に無ければ、ダイヤが変わっている
    for (const stop of t.stops) {
      for (const time of [stop.arrive, stop.depart].filter(Boolean)) {
        if (!plain.includes(time)) {
          problems.push(t.label + ' ' + stop.port + ' ' + time + ' が案内に見当たりません');
        }
      }
    }
  }

  return problems;
}

/** 案内が受け持つ日付だけに絞る。期間の外は、そもそも予定が分からない */
export function datesInForce(dates, notice) {
  return dates.filter((d) => (!notice.from || d >= notice.from) && (!notice.to || d <= notice.to));
}

/** 曜日の決まりから、窓の中の出港日を並べる */
export function departuresFor(dates, timetable) {
  const shipByDay = new Map();
  for (const f of timetable.fleet ?? []) {
    for (const d of f.weekdays) if (!shipByDay.has(d)) shipByDay.set(d, f.ship);
  }
  return dates
    .filter((date) => shipByDay.has(weekdayOf(date)))
    .map((date) => ({
      date,
      ship: shipByDay.get(weekdayOf(date)),
      operator_id: 'amamikaiun',
      name: '奄美海運',
      direction: timetable.direction,
    }));
}

/**
 * 下りと上りのつながりを確かめる。
 *
 * 鹿児島を出た翌日に平土野を折り返すので、下りの出港日の翌日が上りの
 * 出港日になる。船もそのまま引き継がれる。2隻になってからは、この
 * つながりが船の割り当ての裏づけになる（下り月曜のあまみは、火曜の
 * 上りであまみとして戻る）。書き写しを誤ればここで食い違う。
 */
export function checkCycle(departures) {
  const up = new Map((departures.up ?? []).map((d) => [d.date, d.ship]));
  const problems = [];
  for (const d of departures.down ?? []) {
    const next = new Date(d.date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const key = next.toISOString().slice(0, 10);
    if (key > (departures.upTo ?? '9999-12-31')) continue;
    if (!up.has(key)) {
      problems.push(d.date + 'に鹿児島を出た便の、翌日の折り返しがありません');
    } else if (up.get(key) !== d.ship) {
      problems.push(d.date + 'の下りは' + d.ship + 'ですが、翌日の上りが' + up.get(key) + 'になっています');
    }
  }
  return problems;
}

export { WEEKDAYS };
