// 実行の段取りを決める。何を集めるかではなく、いつ集めるかを決める役。
//
// もともと気象の収集と同じ場所に置いていたが、これは収集の仕事ではない。
// 気象は判断の材料のひとつにすぎず、ここで決めるのは
//   ・いま平常か荒天か（モード）
//   ・この周で実際に収集するか（間引き）
// の2つ。収集層から切り離しておくと、間隔を変えるときに
// 公式サイトの読み取りに触らなくて済む。

import { jstDate } from './lib/text.js';
import { NAZE } from './watchers/typhoon.js';


// 荒天モードは、警報が解除されてもすぐには戻さない。
// 警報解除の直後は欠航の判断や振替便の発表が続くため、
// 仕様 §2.2 に従い解除から6時間は荒天モードを維持する。
// 台風・熱帯低気圧がこの距離まで近づいたら荒天モードとする。
// 中心が離れていてもうねりは先に届くため、警報より早く動き出せるようにする。
const NEAR_KM = 600;

const COOLDOWN_HOURS = 6;

export function decideMode(previous, weather, typhoons, now) {
  const nowMs = new Date(now).getTime();

  // 警報が出る前から台風は近づいてくる。
  // 接近段階こそ台風情報も運航の発表も動くため、距離でも荒天モードへ上げる。
  const near = (typhoons ?? []).filter(
    (t) => t.distanceKm !== null && t.distanceKm <= NEAR_KM
  );
  const rough = weather.rough || near.length > 0;
  const reason = weather.rough
    ? '奄美地方に警報が発表中（' + weather.activeWarnings.length + '件）'
    : near.length
      ? near[0].category + 'が' + NAZE.name + 'から約' + near[0].distanceKm + 'kmに接近'
      : null;

  if (rough) {
    return {
      mode: 'rough',
      since: previous.mode === 'rough' ? previous.since ?? now : now,
      rough_last_seen: now,
      reason,
      last_run: now,
    };
  }

  if (previous.mode === 'rough') {
    const lastSeen = previous.rough_last_seen ?? previous.since ?? now;
    const hours = (nowMs - new Date(lastSeen).getTime()) / 3600000;
    if (hours < COOLDOWN_HOURS) {
      return {
        ...previous,
        mode: 'rough',
        reason: `警報解除後の様子見（解除から${hours.toFixed(1)}時間）`,
        last_run: now,
      };
    }
  }

  return { mode: 'normal', since: now, rough_last_seen: null, reason: '警報なし', last_run: now };
}
/**
 * 今回の起動で実際に収集を行うか。
 *
 * ワークフローは15分ごとに起動を試みるが、監視先への負担を抑えるため
 * 実際に取りに行く間隔は平常1時間・荒天30分に保つ（仕様Q17）。
 * 起動の機会を増やしているのは、定期実行が混雑で遅れたときに
 * 次の機会が早く巡ってくるようにするためで、頻度を上げるためではない。
 */
export function shouldRun(mode, previousLastRun, now) {
  if (!previousLastRun) return true;

  // 日本時間の日付が変わったら、間隔に関わらず必ず収集する。
  // 「運航状況」ページは日付をまたいだ瞬間に中身が変わるべきもので、
  // 間引くと日付が変わっても前日のままになる。
  // 実際、23時55分に収集した翌日は、0時50分ごろまで前日の表示が残っていた。
  if (jstDate(now) !== jstDate(previousLastRun)) return true;

  const minutes = (new Date(now) - new Date(previousLastRun)) / 60000;
  // いつ収集するかは節目の一覧（checkpoints）が決める。ここに残すのは
  // 二重に収集しないための下限だけ。節目の最小間隔は10分なので、
  // 5分にしておけば正当な節目を弾かない。
  return minutes >= 5;
}

// ── 節目の時刻 ──────────────────────────────────
//
// 12分ごとという機械的な刻みでは、18:00に鹿児島を出た船が
// 18:11まで「次の出港」のまま残る。意味のある時刻はこちらで分かっている。
//
// ・船が出る時刻と着く時刻（公式の時刻表から導く。表を直せば自動で追従する）
// ・発表が出やすい時間帯（翌日の運航可否は前日の夕方から夜に出る）
// ・日付が変わる直前（ページの「今日」が切り替わる）
//
// 途中の寄港地は入れない。表示していないため、更新する意味がない。

/** 発表が出やすい時間帯。この間は細かく見る */
const NOTICE_WINDOWS = [
  { from: '05:00', to: '08:40', every: 20 }, // 当日朝の判断と、名瀬着・鹿児島着
  { from: '16:00', to: '22:00', every: 20 }, // 翌日の運航可否の発表
];

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const toHHMM = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};

/**
 * 船が出る時刻と着く時刻を時刻表から集める。
 * 出発港の出港と、終着港の入港だけを見る。
 */
export function shipTransitions(timetables = {}) {
  const out = new Map();
  // 同じ時刻に複数の港が重なる（上り2便がどちらも8:30に鹿児島へ着く）。
  // 上書きすると片方の名前が消えるので、まとめる。
  const add = (time, label) => {
    if (!time) return;
    const has = out.get(time);
    if (!has) out.set(time, label);
    else if (!has.includes(label)) out.set(time, has + '・' + label);
  };
  for (const t of Object.values(timetables)) {
    const stops = t.stops ?? [];
    if (!stops.length) continue;
    add(stops[0].depart, stops[0].port + '発');
    add(stops[stops.length - 1].arrive, stops[stops.length - 1].port + '着');
  }
  return out;
}

/** 1日ぶんの節目を「時刻 → 理由」で返す */
export function checkpoints(timetables = {}) {
  const map = new Map();
  const put = (hhmm, why) => {
    const key = toHHMM(toMinutes(hhmm));
    map.set(key, map.has(key) ? map.get(key) + '／' + why : why);
  };

  // 日付が変わったらページの「今日」が切り替わる
  put('00:05', '日付の切り替わり');

  for (const [time, why] of shipTransitions(timetables)) put(time, why);

  for (const w of NOTICE_WINDOWS) {
    for (let m = toMinutes(w.from); m <= toMinutes(w.to); m += w.every) put(toHHMM(m), '発表の確認');
  }

  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

/**
 * 次の節目を返す。荒天のときは節目の間も細かく見る。
 * 節目まで待つのは呼び出し側（ワークフロー）の仕事。
 */
export function nextCheckpoint(now, timetables = {}, { mode = 'normal', roughEvery = 10 } = {}) {
  const jst = new Date(new Date(now).getTime() + JST_OFFSET_MS);
  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes() + jst.getUTCSeconds() / 60;

  const list = [...checkpoints(timetables).entries()].map(([time, why]) => ({ minutes: toMinutes(time), time, why }));

  // 荒天のときは、節目を待たずに一定の間隔でも見る
  if (mode === 'rough') {
    for (let m = 0; m < 1440; m += roughEvery) {
      if (!list.some((c) => c.minutes === m)) list.push({ minutes: m, time: toHHMM(m), why: '荒天' });
    }
    list.sort((a, b) => a.minutes - b.minutes);
  }

  const ahead = list.find((c) => c.minutes > nowMinutes) ?? { ...list[0], minutes: list[0].minutes + 1440 };
  const seconds = Math.max(30, Math.round((ahead.minutes - nowMinutes) * 60));

  return { time: ahead.time, why: ahead.why, seconds };
}
