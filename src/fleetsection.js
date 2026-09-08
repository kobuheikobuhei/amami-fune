// 「現在の運航」。いま航行している船と、次に出港する船を示す。
//
// 欠航の発表だけを並べると、「船が動いているのかどうか」が分からない。
// ドック入りの船があっても、別の船が同じ便を担う。どの船が実際に
// 動いているかを先に示すことで、船の入渠と便の運休の取り違えを防ぐ。
//
// 出港日は両社の公式情報、時刻は両社の公式時刻表による。推測は入れない。

import { COLOR, card } from './style.js';

const RUNNING = '#15803d';
const NEXT = '#1d4ed8';

function jpDateTime(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const w = '日月火水木金土'[d.getUTCDay()];
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日(' + w + ') ' +
    String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

function heading(text, color) {
  return '<div style="color:' + color + ';font-weight:bold;font-size:0.92em;' +
    'letter-spacing:0.04em;margin-bottom:4px">' + text + '</div>';
}

function shipLine(v) {
  return '<div style="font-size:1.12em;font-weight:700;overflow-wrap:anywhere">' + v.ship +
    '<span style="font-size:0.78em;font-weight:400;color:' + COLOR.muted + '">　' + v.name + '</span></div>';
}

function noteLine(note) {
  if (!note) return '';
  const more = note.url
    ? ' <a href="' + note.url + '" style="color:' + COLOR.link + ';font-weight:600">詳しく見る</a>'
    : '';
  return '<div style="margin-top:6px;color:#b45309;font-weight:600;font-size:0.95em;line-height:1.8">' +
    note.text + more + '</div>';
}

/** 航行中の1隻 */
function runningCard(v, now, note) {
  const last = [...v.stops].reverse().find((s) => s.departAt && s.departAt <= now);
  const next = v.stops.find((s) => s.arriveAt && s.arriveAt > now);

  const route = '<div style="margin-top:5px;color:#374151;font-size:0.97em;line-height:1.8;overflow-wrap:anywhere">' +
    jpDateTime(v.departAt) + '　' + v.stops[0].port + '発' +
    '<br>' + jpDateTime(v.arriveAt) + '　' + v.stops[v.stops.length - 1].port + '着</div>';

  const where = (last || next)
    ? '<div style="margin-top:6px;font-size:0.95em;color:' + COLOR.muted + ';line-height:1.8">' +
      (last ? '直前の寄港　' + last.port + ' ' + last.depart + '発' : '') +
      (last && next ? '<br>' : '') +
      (next ? '次の寄港　　' + next.port + ' ' + next.arrive + '着' : '') +
      '</div>'
    : '';

  return card(heading('航行中', RUNNING) + shipLine(v) + route + where + noteLine(note), RUNNING);
}

/** 次に出港する1隻 */
function nextCard(v, note) {
  const stops = v.stops.slice(1, 3)
    .map((s) => s.port + ' ' + jpDateTime(s.arriveAt) + '着')
    .join('<br>');

  return card(
    heading('次の出港', NEXT) + shipLine(v) +
    '<div style="margin-top:5px;color:#374151;font-size:0.97em;line-height:1.8;overflow-wrap:anywhere">' +
    jpDateTime(v.departAt) + '　' + v.stops[0].port + '発</div>' +
    (stops ? '<div style="margin-top:6px;font-size:0.95em;color:' + COLOR.muted + ';line-height:1.8">' + stops + '</div>' : '') +
    noteLine(note),
    NEXT
  );
}

/**
 * 便に関わる発表があれば、その文言を返す。
 * 予定を示しておきながら欠航の発表を伏せるのが、いちばん危うい。
 */
function noticeFor(v, events, labelOf) {
  const hit = (events ?? []).find((e) =>
    e.operator_id === v.operator_id &&
    (e.service_date ?? null) === v.date &&
    (!e.ship || e.ship === v.ship)
  );
  return hit ? { text: labelOf(hit), url: hit.published_post?.url ?? null } : null;
}

/**
 * fleet: { voyages, sources, problems }
 * 解析が壊れているときは何も出さない。誤った予定は、示さないより有害。
 */
export function buildFleetSection({ fleet, now, events = [], labelOf = () => '発表あり' }) {
  if (!fleet || fleet.problems?.length) return '';

  const t = new Date(now).toISOString();
  const running = fleet.voyages.filter((v) => v.departAt <= t && t < v.arriveAt);
  const next = fleet.voyages.find((v) => v.departAt > t) ?? null;
  if (!running.length && !next) return '';

  const cards =
    running.map((v) => runningCard(v, t, noticeFor(v, events, labelOf))).join('') +
    (next ? nextCard(next, noticeFor(next, events, labelOf)) : '');

  const links = (fleet.links ?? [])
    .map((l) => '<a href="' + l.url + '" target="_blank" rel="noopener" style="color:' + COLOR.link + '">' + l.label + '</a>')
    .join('　');

  return '<h2 style="margin:18px 0 10px">現在の運航</h2>' +
    cards +
    '<p style="font-size:0.88em;color:' + COLOR.muted + ';line-height:1.8;margin:-4px 0 18px">' +
    '鹿児島〜奄美群島〜沖縄の下り便（鹿児島発）の予定です。出港日と時刻は各社公式によります。' +
    '天候などで変更されることがあるため、乗船前に各社公式でご確認ください。' +
    (links ? '<br>' + links : '') +
    '</p>';
}
