// 気象庁の警報JSONを見て、荒天モードへの昇格を判定する（仕様 §2.2）。
//
// 判定は「奄美地方に警報以上が発表中かどうか」だけを見る。
// 個々の警報コードの意味（波浪か暴風か）には依存させない。
// 気象庁のコード体系は 02〜09 が警報、10〜27 が注意報、32〜38 が特別警報という
// 構造になっており、範囲で判定すれば個別コードの解釈違いで誤判定しない。

import { fetchText } from '../lib/fetcher.js';

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
