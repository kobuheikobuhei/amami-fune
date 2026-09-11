// 台風特設ページ。
//
// 台風情報そのものは気象庁でも報道でも見られる。このページの意味は、
//   1. 県単位ではなく「名瀬港から何km」という航路目線で示すこと
//   2. 台風・警報・3社の運航状況を一枚にまとめること
//   3. 気象庁と米海軍で強さの数値が食い違う理由を説明すること
// の3点にある。
//
// 進路の予想は載せるが、そこから欠航を推測して書くことはしない（仕様Q28）。

import { STATUS_LABEL, STATUS_COLOR } from './lib/status.js';
import { serviceRow } from './style.js';
import { jstDate } from './lib/text.js';
import { NAZE } from './watchers/typhoon.js';
import { buildDisclaimerBlock } from './disclaimer.js';

const DIRECTION_LABEL = { up: '上り便', down: '下り便' };


function jst(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function row(label, value) {
  if (!value) return '';
  return '<tr><th style="text-align:left;padding:5px 14px 5px 0;white-space:nowrap;color:#555">' +
    label + '</th><td style="padding:5px 0"><strong>' + value + '</strong></td></tr>';
}

/** 予報。台風に発達している間だけ出る */
function forecastTable(t) {
  if (!t.forecasts || !t.forecasts.length) return '';
  const rows = t.forecasts.map(function (f) {
    const dist = f.distanceKm !== null ? f.bearing + ' 約' + f.distanceKm + 'km' : '—';
    const cat = [f.category, f.pressure ? f.pressure + 'hPa' : null].filter(Boolean).join(' ');
    return '<tr>' +
      '<td style="padding:4px 12px 4px 0;white-space:nowrap">' + f.hours + '時間後</td>' +
      '<td style="padding:4px 12px 4px 0;white-space:nowrap">' + (f.validtime ? jst(f.validtime) : '—') + '</td>' +
      '<td style="padding:4px 12px 4px 0;white-space:nowrap">' + dist + '</td>' +
      '<td style="padding:4px 0;white-space:nowrap">' + cat + '</td>' +
      '</tr>';
  }).join('');

  return '<h4 style="margin:14px 0 6px">予報（' + NAZE.name + 'からの距離）</h4>' +
    '<table style="border-collapse:collapse;font-size:0.95em">' +
    '<tr style="border-bottom:1px solid #ddd;color:#555">' +
    '<th style="text-align:left;padding:4px 12px 4px 0">時点</th>' +
    '<th style="text-align:left;padding:4px 12px 4px 0">日時</th>' +
    '<th style="text-align:left;padding:4px 12px 4px 0">' + NAZE.name + 'から</th>' +
    '<th style="text-align:left;padding:4px 0">階級</th></tr>' +
    rows + '</table>' +
    '<p style="font-size:0.85em;color:#666;margin:6px 0 0">' +
    '予報円の中心までの距離です。台風の中心が必ずこの位置を通るという意味ではありません。</p>';
}

/** 台風1つ分の現況 */
function typhoonBlock(t) {
  const title = [
    t.category,
    t.number ? '第' + Number(String(t.number).slice(2)) + '号' : null,
    t.name ? '（' + t.name + '）' : null,
  ].filter(Boolean).join(' ');

  const near = t.distanceKm !== null && t.distanceKm <= 500;
  const color = near ? '#dc2626' : '#2563eb';
  const distance = t.distanceKm !== null
    ? NAZE.name + 'の' + t.bearing + '　約' + t.distanceKm + 'km'
    : null;

  return '<div style="border-left:6px solid ' + color + ';padding:10px 14px;margin:0 0 20px">' +
    '<h3 style="margin:0 0 8px">' + title + '</h3>' +
    '<table style="border-collapse:collapse">' +
    row('中心位置', distance) +
    row('気象庁の表記', t.location) +
    row('大きさ', t.scale) +
    row('強さ', t.intensity) +
    row('中心気圧', t.pressure ? t.pressure + ' hPa' : null) +
    row('最大風速', t.maxWind ? t.maxWind + ' m/s' : null) +
    row('最大瞬間風速', t.gustWind ? t.gustWind + ' m/s' : null) +
    row('進行方向', [t.course, t.speed].filter(Boolean).join(' ')) +
    row('観測時刻', t.validAt ? jst(t.validAt) : null) +
    '</table>' +
    forecastTable(t) +
    '</div>';
}

/** 進路予想図へのリンクと、強度の定義の違いの説明 */
function trackSection(nearest, routePorts) {
  const center = nearest ? nearest.position : null;
  const lat = center && center.lat ? center.lat : NAZE.lat;
  const lon = center && center.lon ? center.lon : NAZE.lon;
  const windy = 'https://embed.windy.com/embed2.html?lat=' + NAZE.lat + '&lon=' + NAZE.lon +
    '&detailLat=' + lat + '&detailLon=' + lon +
    '&zoom=5&level=surface&overlay=wind&menu=&message=&marker=&calendar=now' +
    '&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1';

  return '<h2>進路予想</h2>' +
    '<ul>' +
    '<li><a href="https://www.jma.go.jp/bosai/map.html#contents=typhoon" target="_blank" rel="noopener">気象庁　台風情報</a>（日本の公式発表）</li>' +
    '<li><a href="https://www.metoc.navy.mil/jtwc/jtwc.html" target="_blank" rel="noopener">米海軍 合同台風警報センター（JTWC）</a>（英語）</li>' +
    '</ul>' +
    '<h3>米海軍（JTWC）の進路図の見方</h3>' +
    '<p>JTWCのページは英語で、進路図にたどり着くまでに数手かかります。手順は次のとおりです。</p>' +
    '<ol>' +
    '<li>上のJTWCのリンクを開きます</li>' +
    '<li>地図の中の <strong>Western Pacific</strong>（西太平洋）の区域を選びます。日本付近の台風はここに入ります</li>' +
    '<li>台風の一覧から、該当する番号を選びます。番号は <strong>WP</strong> で始まります（例: WP2625）。' +
      '気象庁の「台風第24号」とは番号の付け方が違うため、名前（Krovanh など）で照合すると確実です</li>' +
    '<li><strong>TC Warning Graphic</strong> をクリックすると進路図が開きます</li>' +
    '</ol>' +
    '<p><strong>時刻は日本時間ではありません。</strong>JTWCの表示は世界標準時（UTC、末尾にZが付きます）です。' +
      '<strong>日本時間はこれに9時間を足します</strong>。' +
      '例えば「061800Z」は6日18時UTCで、日本時間では7日午前3時です。' +
      '9時間前の情報を見ていることになるため、直近の状況は気象庁の発表で確認してください。</p>' +
    '<h3>気象庁と米海軍で数値が違う理由</h3>' +
    '<p>同じ台風でも、気象庁より米海軍（JTWC）の方が強い数値になることがあります。' +
    'これは観測の誤りではなく、<strong>風速の測り方が違う</strong>ためです。</p>' +
    '<ul>' +
    '<li><strong>気象庁</strong>は10分間の平均風速で表します</li>' +
    '<li><strong>米海軍</strong>は1分間の平均風速で表します</li>' +
    '</ul>' +
    '<p>短い時間の平均ほど瞬間的な強い風を拾うため、米海軍の数値の方が大きく出ます。' +
    '台風の階級の呼び方も両者で異なります。' +
    '日本の船会社は気象庁の情報をもとに運航を判断しています。</p>' +
    '<h3>風の状況（Windy）</h3>' +
    '<div style="position:relative;padding-bottom:75%;height:0;overflow:hidden;max-width:100%;margin-bottom:8px">' +
    '<iframe src="' + windy + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ' +
    'frameborder="0" loading="lazy" title="Windy 風の状況"></iframe>' +
    '</div>' +
    '<p style="font-size:0.85em;color:#666">提供: <a href="https://www.windy.com" target="_blank" rel="noopener">Windy.com</a></p>';
}

/** 奄美地方の警報 */
function warningSection(weather) {
  if (!weather) return '';
  if (!weather.rough) {
    return '<h2>奄美地方の警報</h2><p style="color:#16a34a">現在、警報は発表されていません。</p>';
  }
  return '<h2>奄美地方の警報</h2>' +
    '<p style="color:#dc2626;font-weight:bold">警報が発表されています（' + weather.activeWarnings.length + '件）。</p>' +
    (weather.headline ? '<p>' + weather.headline + '</p>' : '') +
    '<p><a href="https://www.jma.go.jp/bosai/warning/#area_type=offices&area_code=460040" target="_blank" rel="noopener">気象庁　奄美地方の警報・注意報</a></p>';
}

// ── 運航の発表 ───────────────────────────────────
//
// 台風のページで知りたいのは「この数日、船は出るのか」であって、
// 2か月先のドック予定ではない。実際、11月のドック運休が4件並んでいた。
// 期間を今日から数日に絞る。
//
// 並べる軸も航路ではなく日付にする。台風のときは日付が主語になるため、
// 「今日の便はどうか」を探しやすい。
//
// 船に関する案内（ドック入り・機関故障）は日付の並びに混ぜない。
// 船が入渠しても別の船が入れば便は動くので、同じ並びに置くと
// 「その日は船が無い」と読まれてしまう。

const HORIZON_DAYS = 3; // 今日・明日・明後日

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function jpDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return m + '月' + d + '日(' + w + ')';
}

function heading(date, index) {
  const name = index === 0 ? '今日' : index === 1 ? '明日' : null;
  return (name ? name + '　' : '') + jpDate(date);
}

/** その日にかかる発表。期間の案内は期間中の全日にかかる */
function eventsOn(events, date) {
  return events.filter((e) =>
    e.service_date <= date && (e.service_date_end ?? e.service_date) >= date);
}

/** 船に関する案内かどうか。便の有無を意味しないため分けて示す */
function isShipLevel(e) {
  return !e.origin && !e.direction && /ドック|入渠|機関故障/.test(e.detail ?? '');
}

function periodText(e) {
  const from = e.service_date.slice(5).replace('-', '/');
  if (!e.service_date_end || e.service_date_end === e.service_date) return from;
  return from + '〜' + e.service_date_end.slice(5).replace('-', '/');
}

/** 期間内に便の発表が何件あるか。先頭の案内を出すかの判断に使う */
function countUpcoming({ routes, eventsByRoute, today }) {
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));
  const all = routes.flatMap((route) => eventsByRoute[route.id] || []);
  const seen = new Set();
  for (const date of dates) {
    for (const e of eventsOn(all, date)) {
      if (!isShipLevel(e)) seen.add(e.event_key || (e.service_date + e.ship + e.origin));
    }
  }
  return seen.size;
}

function operationSection({ routes, eventsByRoute, noticesByRoute, pageIds, today }) {
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));
  const horizonEnd = dates[dates.length - 1];

  const all = routes.flatMap((route) =>
    (eventsByRoute[route.id] || []).map((e) => ({ ...e, route })));

  // 日付ごとの便の発表
  const days = dates.map((date, i) => {
    const hits = eventsOn(all, date)
      .filter((e) => !isShipLevel(e))
      .sort((a, b) => (a.origin || '').localeCompare(b.origin || ''));

    const rows = hits.length
      ? hits.map((e) => serviceRow({
          when: e.ship || e.route.short || e.route.name,
          statusText: e.detail || STATUS_LABEL[e.status],
          color: STATUS_COLOR[e.status],
          segment: [
            e.origin ? e.origin + '発' : null,
            DIRECTION_LABEL[e.direction] || null,
            e.ship ? e.route.short || e.route.name : null,
          ].filter(Boolean).join('　'),
          href: e.published_post && e.published_post.url,
        })).join('')
      : '<p style="color:#6b7280;margin:4px 0 14px">発表はありません</p>';

    return '<h3 style="margin:18px 0 4px;font-size:1.05em">' + heading(date, i) + '</h3>' + rows;
  }).join('');

  // 船に関する案内。期間にかかるものだけ
  const ships = all
    .filter(isShipLevel)
    .filter((e) => e.service_date <= horizonEnd && (e.service_date_end ?? e.service_date) >= today);

  const notices = routes.flatMap((route) => (noticesByRoute[route.id] || []));

  const shipItems = [
    ...ships.map((e) =>
      '<li>' + (e.ship ? e.ship + 'は' : '') + '<strong>' + (e.detail || STATUS_LABEL[e.status]) +
      '</strong>（' + periodText(e) + '）</li>'),
    ...notices.map((n) =>
      '<li>' + (n.ship ? n.ship + 'は' : '') + '<strong>' + (n.detail || STATUS_LABEL[n.status]) +
      '</strong>（継続中）</li>'),
  ].join('');

  const shipBlock = shipItems
    ? '<h3 style="margin:20px 0 4px;font-size:1.05em">船の状況</h3>' +
      '<ul style="margin:4px 0 6px;padding-left:1.3em;line-height:2;color:#b45309">' + shipItems + '</ul>' +
      '<p style="font-size:0.9em;color:#555;margin:0 0 10px;line-height:1.8">' +
      'ドック入りや故障で1隻が離れていても、別の船が同じ便を担うことがあります。' +
      'その日に動く船は<a href="' + (pageIds.__daily && pageIds.__daily.url ? pageIds.__daily.url : '#') +
      '" style="color:#1d4ed8;font-weight:600">運航状況</a>でご覧いただけます。</p>'
    : '';

  const links = routes
    .map((r) => ({ label: r.short || r.name, url: pageIds[r.id] && pageIds[r.id].url }))
    .filter((x) => x.url)
    .map((x) => '<a href="' + x.url + '" style="color:#1d4ed8;font-weight:600">' + x.label + '</a>')
    .join('<span style="color:#cbd5e1"> ｜ </span>');

  return '<h2 id="unko">欠航・ダイヤ変更の発表</h2>' +
    '<p style="font-size:0.92em;color:#555;margin:0 0 4px;line-height:1.8">' +
    '今日からの' + HORIZON_DAYS + '日分です。翌日の運航可否は、前日の夕方から夜にかけて' +
    '発表されることが多くなっています。</p>' +
    days +
    shipBlock +
    (links
      ? '<p style="font-size:0.92em;color:#555;margin:14px 0 0;line-height:2">' +
        'これより先の発表は、航路ごとのページに掲載しています。<br>' + links + '</p>'
      : '');
}

export function buildTyphoonPage({ typhoons, weather, routes, eventsByRoute, noticesByRoute = {}, pageIds = {}, nav = "", now }) {
  const today = jstDate(now);
  const routePorts = routes && routes.length ? (routes[0].ports || []) : [];
  const active = typhoons || [];
  const withDistance = active.filter(function (t) { return t.distanceKm !== null; });
  withDistance.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
  const nearest = withDistance[0];

  // ページは長い。台風の現況の下に進路予想の説明が続くため、
  // 発表があるときは先に知らせて飛べるようにする。
  const upcoming = countUpcoming({ routes, eventsByRoute, today });
  const jump = upcoming
    ? '<p style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 13px;' +
      'margin:0 0 14px;font-size:0.98em;line-height:1.8">' +
      '欠航・ダイヤ変更の発表が' + upcoming + '件あります　' +
      '<a href="#unko" style="color:#b91c1c;font-weight:700">発表を見る ▼</a></p>'
    : '';

  const head = active.length
    ? active.map(typhoonBlock).join('')
    : '<p style="color:#16a34a;font-size:1.05em">現在、発生中の台風・熱帯低気圧はありません。</p>';

  return {
    title: '台風情報と運航状況',
    body:
      nav + '<p style="color:#555;font-size:0.9em;line-height:1.7">公式情報の確認日時: ' + jst(now) + '</p>' +
      jump +
      '<h2>発生中の台風・熱帯低気圧</h2>' +
      head +
      warningSection(weather) +
      operationSection({ routes, eventsByRoute, noticesByRoute, pageIds, today }) +
      trackSection(nearest, routePorts) +
      '<hr>' +
      '<p style="font-size:0.9em;color:#555">台風の情報の出典: 気象庁（' +
      '<a href="https://www.jma.go.jp/" target="_blank" rel="noopener">https://www.jma.go.jp/</a>）</p>' +
      buildDisclaimerBlock(),
  };
}
