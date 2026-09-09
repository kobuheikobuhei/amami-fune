// 「運航状況」ページ。
//
// 全社を横断して「いま船が動いているか」を1枚で見せる。
// 航路別の常設ページは3枚に分かれており、
// 「今どの船で渡れるか」を知りたい人が3枚を開かずに済むようにする。
//
// 記事を増やさず1枚を更新し続ける形にしている（仕様Q22）。
// URLが変わらないので、ブックマークして毎日開いてもらえる。

import { STATUS_LABEL } from './lib/status.js';
import { buildFleetSection } from './fleetsection.js';
import { fleetOperatorIds } from './fleet/voyages.js';

const DISCLAIMER =
  '最終的な運航可否は必ず各社公式サイトでご確認ください。当サイトは公式発表をもとに自動で情報を掲載しています。';

// 台帳には古い表記が残るため、表示する語に寄せ直す。
const DETAIL_DISPLAY = {
  ドック: 'ドック入り',
  入渠: 'ドック入り',
  機関故障: '機関故障',
};

function jst(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function label(e) {
  const d = e.detail ? DETAIL_DISPLAY[e.detail] || e.detail : null;
  return d || STATUS_LABEL[e.status];
}

/**
 * 航路別のページへの案内。
 *
 * このページは動いている船を示すもので、発表の一覧は持たない。
 * 案内が無いと「発表が無い」と読まれるため、どこにあるかを明示する。
 */
function routeGuide(routes, pageIds) {
  const links = routes
    .map((r) => ({ label: r.short ?? r.name, url: pageIds?.[r.id]?.url }))
    .filter((x) => x.url)
    .map((x) => '<a href="' + x.url + '" style="color:#1d4ed8;font-weight:600">' + x.label + '</a>');

  if (!links.length) return '';

  return '<p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;' +
    'padding:10px 13px;margin:0 0 16px;font-size:0.95em;line-height:2">' +
    '欠航・条件付運航・ドック入りなどの発表は、航路ごとのページに掲載しています。<br>' +
    links.join('<span style="color:#cbd5e1"> ｜ </span>') +
    '</p>';
}

export function buildDailyPage({
  routes = [], pageIds = {}, events = [], fleet = null,
  nav = '', alert = '', scope = '', now,
}) {
  return {
    title: '運航状況',
    body:
      nav +
      // daily-core はページ全体、daily-now はホームに出す分。
      // ホームには「いま何が動いているか」だけを出し、
      // 案内や注意書きはページ本体に置く。
      '<div id="daily-core">' +
      '<div id="daily-now">' + alert +
      '<p style="color:#555;font-size:0.9em;line-height:1.7">公式情報の確認日時: ' + jst(now) + '</p>' +
      buildFleetSection({
        fleet,
        now,
        events,
        labelOf: (e) => label(e) + 'の発表があります',
      }) +
      '</div>' +
      routeGuide(routes, pageIds) +
      scope +
      '<hr>' +
      '<p style="font-size:0.9em;color:#555">' + DISCLAIMER + '</p>' +
      '</div>',
  };
}

export { label, fleetOperatorIds };
