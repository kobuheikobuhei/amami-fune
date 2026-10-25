// 「現在の運航」。いま航行している船と、次に出港する船を示す。
//
// 欠航の発表だけを並べると、「船が動いているのかどうか」が分からない。
// ドック入りの船があっても、別の船が同じ便を担う。どの船が実際に
// 動いているかを先に示すことで、船の入渠と便の運休の取り違えを防ぐ。
//
// 出港日は各社の公式情報、時刻は公式の時刻表による。推測は入れない。

import { COLOR } from './style.js';
import { STATUS } from './lib/status.js';
import { jstDate } from './lib/text.js';

const RUNNING = '#15803d';
const NEXT = '#1d4ed8';
const CANCELLED = '#dc2626';

function jpDateTime(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const w = '日月火水木金土'[d.getUTCDay()];
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日(' + w + ') ' +
    String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

/** 囲み。左端の色帯で種類を示す */
function box(inner, accent) {
  return '<div style="border:1px solid ' + COLOR.line + ';border-left:5px solid ' + accent +
    ';border-radius:8px;padding:10px 13px;margin:0 0 10px;background:#fff">' + inner + '</div>';
}

function tag(text, color) {
  return '<div style="color:' + color + ';font-weight:bold;font-size:0.9em;' +
    'letter-spacing:0.04em;margin-bottom:3px">' + text + '</div>';
}

function shipLine(v) {
  return '<div style="font-size:1.1em;font-weight:700;overflow-wrap:anywhere">' + v.ship +
    '<span style="font-size:0.78em;font-weight:400;color:' + COLOR.muted + '">　' + v.name + '</span></div>';
}

function noteLine(note) {
  if (!note) return '';
  const more = note.url
    ? ' <a href="' + note.url + '" style="color:' + COLOR.link + ';font-weight:600">詳しく見る</a>'
    : '';
  return '<div style="margin-top:5px;color:#b45309;font-weight:600;font-size:0.95em;line-height:1.8">' +
    note.text + more + '</div>';
}

function sub(text) {
  return '<div style="margin-top:5px;font-size:0.94em;color:' + COLOR.muted + ';line-height:1.8">' + text + '</div>';
}

function span(v) {
  const first = v.stops[0];
  const last = v.stops[v.stops.length - 1];
  return '<div style="margin-top:4px;color:#374151;font-size:0.96em;line-height:1.8;overflow-wrap:anywhere">' +
    jpDateTime(v.departAt) + '　' + first.port + '発<br>' +
    jpDateTime(v.arriveAt) + '　' + last.port + '着</div>';
}

/** 航行中の1隻 */
function runningBox(v, now, note) {
  return box(tag('航行中', RUNNING) + shipLine(v) + span(v) + noteLine(note), RUNNING);
}

/** 次に出港する1隻 */
function nextBox(v, note) {
  return box(tag('次の出港', NEXT) + shipLine(v) + span(v) + noteLine(note), NEXT);
}

/**
 * 便に関わる発表があれば、その文言と記事を返す。
 * 予定を示しておきながら欠航の発表を伏せるのが、いちばん危うい。
 */
function noticeFor(v, events, labelOf) {
  const hit = (events ?? []).find((e) =>
    e.operator_id === v.operator_id &&
    (e.service_date ?? null) === v.date &&
    (!e.ship || e.ship === v.ship) &&
    (!e.direction || e.direction === v.direction)
  );
  return hit
    ? { text: labelOf(hit), url: hit.published_post?.url ?? null, status: hit.status ?? null }
    : null;
}

/** 欠航の1隻。時刻表の上では動いている時間でも、この船は出ていない */
function cancelledBox(v, note) {
  return box(tag('欠航', CANCELLED) + shipLine(v) + span(v) + noteLine(note), CANCELLED);
}

/**
 * 片方向ぶんの並び。
 *
 * 「航行中」「次の出港」を時刻表だけで決めると、欠航の発表が出ている便まで
 * 緑の「航行中」で出てしまう。動いていない船を動いていると告げるのが、
 * この画面でいちばん紛らわしい。欠航の便は札を「欠航」に変える。
 *
 * 札を変えるだけで、便そのものは消さない。消すと、載っていないのが
 * 欠航なのか載せ忘れなのか読者に分からなくなる。
 */
function directionBlock({ voyages, label, now, events, labelOf }) {
  const marked = voyages.map((v) => {
    const note = noticeFor(v, events, labelOf);
    return { v, note, cancelled: note?.status === STATUS.CANCELLED };
  });

  // 前の日に出るはずだった欠航の便は、もう出さない。
  //
  // 欠航した船は進んでいないのに、時刻表の上では「出港済み・到着前」の
  // 時間帯に入るため、着くはずだった時刻まで航行中の枠に居座っていた。
  // 昨日18時の便が、今日の便より上に出ている状態になる。
  //
  // 当日のうちは残す。1時間前に欠航した便は、乗る予定だった人に
  // とっていちばん大事な情報で、日付が変わるまでは現在の話に属する。
  const today = jstDate(now);
  const overAndGone = (m) => m.cancelled && m.v.departAt <= now && jstDate(m.v.departAt) < today;

  const sailing = marked.filter(
    (m) => m.v.departAt <= now && now < m.v.arriveAt && !overAndGone(m)
  );
  const next = marked.find((m) => m.v.departAt > now) ?? null;
  if (!sailing.length && !next) return '';

  // 航行中が無いことは、隠さずそのまま示す。
  // 何も書かないと、載せ忘れているのか本当に無いのかが読者に分からない。
  // 欠航で1隻も動いていないときも、ここに出る。
  const idle = !sailing.some((m) => !m.cancelled)
    ? box(tag('航行中', COLOR.muted) +
        '<div style="color:' + COLOR.muted + '">いま航行している便はありません</div>', COLOR.line)
    : '';

  const nextBlock = next
    ? (next.cancelled ? cancelledBox(next.v, next.note) : nextBox(next.v, next.note))
    : '';

  return '<h4 style="margin:14px 0 8px;font-size:1em">' + label + '</h4>' +
    idle +
    sailing.map((m) => (m.cancelled ? cancelledBox(m.v, m.note) : runningBox(m.v, now, m.note))).join('') +
    nextBlock;
}

/** 航路ひとつぶん */
function routeBlock(route, { now, events, labelOf }) {
  const inner = route.services
    .map((s) => directionBlock({ ...s, now, events, labelOf }))
    .filter(Boolean)
    .join('');
  if (!inner) return '';

  const links = (route.links ?? [])
    .map((l) => '<a href="' + l.url + '" target="_blank" rel="noopener" style="color:' + COLOR.link + '">' + l.label + '</a>')
    .join('　');

  const note = route.note
    ? '<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 11px;' +
      'margin:6px 0 0;font-size:0.92em;line-height:1.8;color:#92400e">' +
      route.note.trim().split(String.fromCharCode(10)).join("<br>") + "</p>"
    : '';

  const operators = route.operators
    ? '<div style="font-size:0.86em;color:' + COLOR.muted + ';margin-bottom:2px">' + route.operators + '</div>'
    : '';

  const linkLine = links
    ? '<p style="font-size:0.86em;color:' + COLOR.muted + ';margin:-2px 0 6px;line-height:1.8">' + links + '</p>'
    : '';

  return '<h3 style="margin:22px 0 2px;font-size:1.08em">' + route.group + '</h3>' +
    operators + note + inner + linkLine;
}

/**
 * fleet: { routes: [{ group, operators, services, links }], problems }
 * 解析が壊れているときは何も出さない。誤った予定は、示さないより有害。
 */
export function buildFleetSection({ fleet, now, events = [], labelOf = () => '発表あり' }) {
  if (!fleet || fleet.problems?.length) return '';

  const t = new Date(now).toISOString();
  const blocks = (fleet.routes ?? [])
    .map((r) => routeBlock(r, { now: t, events, labelOf }))
    .filter(Boolean)
    .join('');
  if (!blocks) return '';

  return '<h2 style="margin:18px 0 4px">現在の運航</h2>' +
    blocks +
    '<p style="font-size:0.88em;color:' + COLOR.muted + ';line-height:1.8;margin:10px 0 18px">' +
    '出港日と時刻は各社公式によります。天候などで変更されることがあるため、' +
    '乗船前に各社公式でご確認ください。</p>';
}
