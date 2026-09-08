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

// 知らせる距離。台風と熱帯低気圧で変える。
// 熱帯低気圧は勢力が弱く、遠方のものまで知らせると警告の意味が薄れる。
const ALERT_KM_TYPHOON = 1200;
const ALERT_KM_TD = 800;

/** 気象庁の階級が台風に達しているか（強い台風・非常に強い台風なども含む） */
function isTyphoon(t) {
  return /台風/.test(t.category ?? '');
}

export function buildTyphoonAlert({ typhoons = [], url = null } = {}) {
  const active = typhoons.filter((t) => {
    if (t.distanceKm === null) return true;
    return t.distanceKm <= (isTyphoon(t) ? ALERT_KM_TYPHOON : ALERT_KM_TD);
  });
  if (!active.length || !url) return '';

  // 台風があるならその中から選ぶ。見出しが「台風」なのに
  // 名前の欄が熱帯低気圧になっていると、読者が取り違える。
  const pool = active.some(isTyphoon) ? active.filter(isTyphoon) : active;
  const withDistance = pool.filter((t) => t.distanceKm !== null);
  withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = withDistance[0] ?? pool[0];

  const name = [
    nearest.category,
    nearest.number ? '第' + Number(String(nearest.number).slice(2)) + '号' : null,
    nearest.name ? '（' + nearest.name + '）' : null,
  ].filter(Boolean).join(' ');

  const where = nearest.distanceKm !== null
    ? NAZE.name + 'の' + nearest.bearing + '　約' + nearest.distanceKm + 'km'
    : null;

  const others = active.length > 1 ? '　ほか' + (active.length - 1) + '件' : '';

  // 見出しは実際の階級に合わせる。
  // 熱帯低気圧なのに「台風が発生しています」と書くと、
  // すぐ下の階級の表示と矛盾し、読者を誤らせる。
  const headline = active.some(isTyphoon)
    ? '台風が発生しています'
    : '熱帯低気圧が発生しています';

  return '<div style="border:2px solid #dc2626;background:#fef2f2;border-radius:8px;' +
    'padding:12px 16px;margin:0 0 18px">' +
    '<div style="color:#b91c1c;font-weight:bold;font-size:1.05em;margin-bottom:4px">' +
    headline + '</div>' +
    '<div style="color:#7f1d1d">' + name + others +
    (where ? '<br><span style="font-size:0.95em">' + where + '</span>' : '') +
    '</div>' +
    '<p style="margin:8px 0 0">' +
    '<a href="' + url + '" style="color:#b91c1c;font-weight:bold">' +
    '台風情報と運航状況を見る</a></p>' +
    '</div>';
}
