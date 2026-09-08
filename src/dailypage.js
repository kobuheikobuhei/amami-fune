// 「今日・明日の運航状況」ページ。
//
// 常設ページは航路別に分かれているため、全社を横断して見る手段がなかった。
// 「明日、どれかの船で渡れるか」を知りたい人が3枚を開かずに済むようにする。
//
// 記事を増やさず1枚を更新し続ける形にしている（仕様Q22）。
// URLが変わらないので、ブックマークして毎日開いてもらえる。

import { STATUS_LABEL, STATUS_COLOR } from './lib/status.js';
import { jstDate } from './lib/text.js';

const DIRECTION_LABEL = { up: '上り便', down: '下り便' };

const DISCLAIMER =
  '最終的な運航可否は必ず各社公式サイトでご確認ください。当サイトは公式発表をもとに自動で情報を掲載しています。';

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

function label(e) {
  const d = e.detail ? DETAIL_DISPLAY[e.detail] || e.detail : null;
  return d || STATUS_LABEL[e.status];
}

/** その日にかかる便を拾う。期間の案内は期間中の全日にかかる */
function eventsOn(events, date) {
  return events
    .filter((e) => e.service_date <= date && (e.service_date_end ?? e.service_date) >= date)
    .sort((a, b) => (a.origin ?? '').localeCompare(b.origin ?? ''));
}

// 船に関する案内は、便が無くなることを意味しない。
// ドック入りでも別の船が入れば便は動く。同じ並びに置くと
// 「船が来ない」と誤解されるため、分けて示す。
// 船に関する案内かどうかは、語を含むかで判定する。
// 台帳には古い表記（「ドック」だけなど）が残るため、完全一致では取りこぼす。
function isShipLevel(e) {
  const d = e.detail ?? '';
  return /ドック|入渠|機関故障/.test(d) && !e.origin && !e.direction;
}

function dayBlock(date, routes, eventsByRoute, noticesByRoute, operators, normalByRoute, heading) {
  const blocks = routes.map((route) => {
    const all = eventsOn(eventsByRoute[route.id] ?? [], date);
    const ships = all.filter(isShipLevel);
    const services = all.filter((e) => !isShipLevel(e));
    const notices = noticesByRoute[route.id] ?? [];
    const op = operators?.[route.operator_id];

    const noticeItems = notices.map((n) => {
      const ship = n.ship ? n.ship + 'は' : '';
      const text = n.detail ?? STATUS_LABEL[n.status];
      return '<li style="color:#b45309">' + ship + '<strong>' + text + '</strong>（継続中）</li>';
    }).join('');

    const shipItems = ships.map((e) => {
      const name = e.ship ? e.ship + 'は' : '';
      return '<li style="color:#b45309">' + name + '<strong>' + label(e) + '</strong></li>';
    }).join('');

    // 公式が通常運航と掲げている船。ドック入りの船があっても、
    // 別の船が動いていることを読者に伝えられる唯一の根拠になる。
    const normalItems = (normalByRoute[route.id] ?? []).map((n) =>
      '<li style="color:#166534">' + n.ship + 'は<strong>通常運航</strong>' +
      ' <a href="' + n.source_url + '" target="_blank" rel="noopener" style="font-size:0.9em">公式</a></li>'
    ).join('');

    const serviceItems = services.map((e) => {
      const seg = [e.origin ? e.origin + "発" : null, DIRECTION_LABEL[e.direction] ?? null]
        .filter(Boolean).join(' ');
      const ship = e.ship ? e.ship + '　' : '';
      const link = e.published_post?.url
        ? '　<a href="' + e.published_post.url + '">詳細</a>' : '';
      return '<li>' + ship + (seg ? seg + '　' : '') +
        '<strong style="color:' + STATUS_COLOR[e.status] + '">' + label(e) + '</strong>' + link + '</li>';
    }).join('');

    // 船の案内があるときは、便の有無を時刻表で確かめてもらう
    // 船の案内があるときは、実際に便があるかを読者が確かめられるようにする。
    // 時刻表は「何時発か」、配船予定は「どの船が動くか」で、必要なのは後者。
    // 船の案内があるときは、実際に便があるかを読者が確かめられるようにする。
    // PDFへ直接ではなく、それが置かれているページへ案内する。
    // PDFのURLはハッシュ値で、差し替えられればリンクが切れるため。
    const links = (op?.references ?? []).map((r) =>
      '<a href="' + r.url + '" target="_blank" rel="noopener">' + r.label + '</a>');

    const scheduleHint = (shipItems || noticeItems) && links.length
      ? '<p style="font-size:0.92em;color:#555;margin:2px 0 12px;line-height:1.9">' +
        'どの船が動く予定かは ' + links.join('　') + ' でご確認ください。</p>'
      : '';

    const body = (noticeItems || shipItems || normalItems || serviceItems)
      ? '<ul style="margin:4px 0 6px;line-height:2.1;padding-left:1.3em">' +
        noticeItems + shipItems + normalItems + serviceItems + '</ul>' + scheduleHint
      : '<p style="color:#6b7280;margin:4px 0 14px">発表はありません</p>';

    return '<div style="margin-bottom:6px"><strong style="font-size:1.05em">' + route.name + '</strong>' + body + '</div>';
  }).join('');

  return '<h2 style="margin:22px 0 8px">' + heading + '　' + jpDate(date) + '</h2>' + blocks;
}

export function buildDailyPage({ routes, eventsByRoute, noticesByRoute = {}, operators = {}, normalByRoute = {}, nav = "", alert = "", scope = "", now }) {
  const today = jstDate(now);
  const tomorrow = addDays(today, 1);

  return {
    title: '今日・明日の運航状況',
    body:
      nav +
      '<div id="daily-core">' + alert +
      '<p style="color:#555;font-size:0.9em;line-height:1.7">公式情報の確認日時: ' + jst(now) + '</p>' +
      dayBlock(today, routes, eventsByRoute, noticesByRoute, operators, normalByRoute, '今日') +
      dayBlock(tomorrow, routes, eventsByRoute, {}, operators, normalByRoute, '明日') +
      '<p style="color:#555;font-size:0.9em">翌日の運航可否は、前日の夕方から夜にかけて発表されることが多くなっています。' +
      'まだ発表がない場合は、時間をおいて再度ご確認ください。</p>' +
      scope +
      '<hr>' +
      '<p style="font-size:0.9em;color:#555">' + DISCLAIMER + '</p>' +
      '</div>',
  };
}
