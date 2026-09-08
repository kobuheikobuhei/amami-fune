// 台風発生時の警告。
//
// 短く、どこにいても目に入ることを優先する。
// 台風の詳細をここに展開すると、読者が最も知りたい「今日渡れるか」が
// 下へ押し下げられてしまうため、1行の知らせと詳細への導線だけに絞る。
//
// 毎回作り直すページにだけ入れる。個別の記事には入れない。
// 記事は作った時点で内容が固定されるため、台風が去っても警告が残り、
// 何ヶ月も前の警報を現在のものとして見せることになる。

import { NAZE } from './watchers/typhoon.js';

/** 名瀬港からこの距離までを「発生中」として知らせる */
const ALERT_KM = 1200;

export function buildTyphoonAlert({ typhoons = [], url = null } = {}) {
  const active = typhoons.filter(
    (t) => t.distanceKm === null || t.distanceKm <= ALERT_KM
  );
  if (!active.length || !url) return '';

  const nearest = active
    .filter((t) => t.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? active[0];

  const name = [
    nearest.category,
    nearest.number ? '第' + Number(String(nearest.number).slice(2)) + '号' : null,
    nearest.name ? '（' + nearest.name + '）' : null,
  ].filter(Boolean).join(' ');

  const where = nearest.distanceKm !== null
    ? NAZE.name + 'の' + nearest.bearing + '　約' + nearest.distanceKm + 'km'
    : null;

  const others = active.length > 1 ? '　ほか' + (active.length - 1) + '件' : '';

  return '<div style="border:2px solid #dc2626;background:#fef2f2;border-radius:8px;' +
    'padding:12px 16px;margin:0 0 18px">' +
    '<div style="color:#b91c1c;font-weight:bold;font-size:1.05em;margin-bottom:4px">' +
    '台風が発生しています</div>' +
    '<div style="color:#7f1d1d">' + name + others +
    (where ? '<br><span style="font-size:0.95em">' + where + '</span>' : '') +
    '</div>' +
    '<p style="margin:8px 0 0">' +
    '<a href="' + url + '" style="color:#b91c1c;font-weight:bold">' +
    '台風情報と運航状況を見る</a></p>' +
    '</div>';
}
