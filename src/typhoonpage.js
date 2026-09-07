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
import { NAZE } from './watchers/typhoon.js';

const DISCLAIMER =
  '最終的な運航可否は必ず各社公式サイトでご確認ください。当サイトは公式発表をもとに自動で情報を掲載しています。';

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
function trackSection(center) {
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
    '<h3>風の状況（Windy）</h3>' +
    '<div style="position:relative;padding-bottom:75%;height:0;overflow:hidden;max-width:100%;margin-bottom:8px">' +
    '<iframe src="' + windy + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ' +
    'frameborder="0" loading="lazy" title="Windy 風の状況"></iframe>' +
    '</div>' +
    '<p style="font-size:0.85em;color:#666">提供: <a href="https://www.windy.com" target="_blank" rel="noopener">Windy.com</a></p>' +
    '<h3>気象庁と米海軍で数値が違う理由</h3>' +
    '<p>同じ台風でも、気象庁より米海軍（JTWC）の方が強い数値になることがあります。' +
    'これは観測の誤りではなく、<strong>風速の測り方が違う</strong>ためです。</p>' +
    '<ul>' +
    '<li><strong>気象庁</strong>は10分間の平均風速で表します</li>' +
    '<li><strong>米海軍</strong>は1分間の平均風速で表します</li>' +
    '</ul>' +
    '<p>短い時間の平均ほど瞬間的な強い風を拾うため、米海軍の数値の方が大きく出ます。' +
    '台風の階級の呼び方も両者で異なります。' +
    '日本の船会社は気象庁の情報をもとに運航を判断しています。</p>';
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

/** 3社の運航状況の要約 */
function operationSection(routes, eventsByRoute, today) {
  const blocks = routes.map(function (route) {
    const events = (eventsByRoute[route.id] || [])
      .filter(function (e) { return (e.service_date_end || e.service_date) >= today; })
      .sort(function (a, b) { return a.service_date.localeCompare(b.service_date); })
      .slice(0, 6);

    const items = events.length
      ? events.map(function (e) {
          const color = STATUS_COLOR[e.status];
          const label = e.detail || STATUS_LABEL[e.status];
          const when = e.service_date_end && e.service_date_end !== e.service_date
            ? e.service_date.slice(5).replace('-', '/') + '〜' + e.service_date_end.slice(5).replace('-', '/')
            : e.service_date.slice(5).replace('-', '/');
          const link = e.published_post && e.published_post.url
            ? '　<a href="' + e.published_post.url + '">詳細</a>' : '';
          return '<li>' + when + '　<strong style="color:' + color + '">' + label + '</strong>' + link + '</li>';
        }).join('')
      : '<li style="color:#6b7280">欠航・ダイヤ変更の発表はありません</li>';

    return '<h3>' + route.name + '</h3><ul>' + items + '</ul>';
  }).join('');

  return '<h2>運航状況</h2>' + blocks;
}

export function buildTyphoonPage({ typhoons, weather, routes, eventsByRoute, now }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const active = typhoons || [];
  const withDistance = active.filter(function (t) { return t.distanceKm !== null; });
  withDistance.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
  const nearest = withDistance[0];

  const head = active.length
    ? active.map(typhoonBlock).join('')
    : '<p style="color:#16a34a;font-size:1.05em">現在、発生中の台風・熱帯低気圧はありません。</p>';

  return {
    title: '台風情報と運航状況',
    body:
      '<p style="color:#555;font-size:0.9em">最終更新: ' + jst(now) + '</p>' +
      '<h2>発生中の台風・熱帯低気圧</h2>' +
      head +
      trackSection(nearest ? nearest.position : null) +
      warningSection(weather) +
      operationSection(routes, eventsByRoute, today) +
      '<hr>' +
      '<p style="font-size:0.9em;color:#555">台風の情報の出典: 気象庁（' +
      '<a href="https://www.jma.go.jp/" target="_blank" rel="noopener">https://www.jma.go.jp/</a>）<br>' +
      DISCLAIMER + '</p>',
  };
}
