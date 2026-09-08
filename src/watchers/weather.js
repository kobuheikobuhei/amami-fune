// 気象庁の警報JSONを見て、荒天モードへの昇格を判定する（仕様 §2.2）。
//
// 判定は「奄美地方に警報以上が発表中かどうか」だけを見る。
// 個々の警報コードの意味（波浪か暴風か）には依存させない。
// 気象庁のコード体系は 02〜09 が警報、10〜27 が注意報、32〜38 が特別警報という
// 構造になっており、範囲で判定すれば個別コードの解釈違いで誤判定しない。

import { fetchText } from '../lib/fetcher.js';
import { NAZE } from './typhoon.js';

// 奄美大島とその周辺（喜界島を含む）。仕様Q6の対象範囲に対応する。
export const AMAMI_AREA_CODES = new Set([
  '460040', // 奄美地方
  '4622200', // 奄美市
  '4652300', // 大和村
  '4652400', // 宇検村
  '4652500', // 瀬戸内町
  '4652700', // 龍郷町
  '4652900', // 喜界町
]);

const INACTIVE_STATUS = ['解除', '発表警報・注意報はなし', ''];

function isWarningLevel(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return false;
  return (n >= 2 && n <= 9) || (n >= 32 && n <= 38); // 警報 または 特別警報
}

export async function watchWeather(source, { userAgent }) {
  const { body, fetchedAt } = await fetchText(source.url, { userAgent });
  const data = JSON.parse(body);

  const active = [];
  for (const at of data.areaTypes ?? []) {
    for (const area of at.areas ?? []) {
      if (!AMAMI_AREA_CODES.has(String(area.code))) continue;
      for (const w of area.warnings ?? []) {
        if (INACTIVE_STATUS.includes(w.status ?? '')) continue;
        if (!isWarningLevel(w.code)) continue;
        active.push({ area: String(area.code), code: String(w.code), status: w.status });
      }
    }
  }

  return {
    fetchedAt,
    reportDatetime: data.reportDatetime ?? null,
    headline: data.headlineText ?? '',
    activeWarnings: active,
    rough: active.length > 0,
  };
}

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
  const minutes = (new Date(now) - new Date(previousLastRun)) / 60000;
  // 起動の揺らぎで1回飛ばされないよう、目標より少し手前で通す
  return minutes >= (mode === 'rough' ? 25 : 55);
}
