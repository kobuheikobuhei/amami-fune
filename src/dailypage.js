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
  ドック: 'ドック入り・運休',
  入渠: 'ドック入り・運休',
  機関故障: '機関故障・運休',
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

function dayBlock(date, routes, eventsByRoute, noticesByRoute, heading) {
  const blocks = routes.map((route) => {
    const events = eventsOn(eventsByRoute[route.id] ?? [], date);
    const notices = noticesByRoute[route.id] ?? [];

    const noticeItems = notices.map((n) => {
      const ship = n.ship ? n.ship + 'は' : '';
      const text = n.detail ? DETAIL_DISPLAY[n.detail] || n.detail : STATUS_LABEL[n.status];
      return '<li style="color:#b45309">' + ship + '<strong>' + text + '</strong>（継続中）</li>';
    }).join('');

    const items = events.map((e) => {
      const seg = [e.origin ? e.origin + '発' : null, DIRECTION_LABEL[e.direction] ?? null]
        .filter(Boolean).join(' ');
      const ship = e.ship ? e.ship + '　' : '';
      const link = e.published_post?.url
        ? '　<a href="' + e.published_post.url + '">詳細</a>' : '';
      return '<li>' + ship + (seg ? seg + '　' : '') +
        '<strong style="color:' + STATUS_COLOR[e.status] + '">' + label(e) + '</strong>' + link + '</li>';
    }).join('');

    const body = noticeItems + items
      ? '<ul style="margin:4px 0 12px">' + noticeItems + items + '</ul>'
      : '<p style="color:#6b7280;margin:4px 0 12px">発表はありません</p>';

    return '<div style="margin-bottom:4px"><strong>' + route.name + '</strong>' + body + '</div>';
  }).join('');

  return '<h2>' + heading + '　' + jpDate(date) + '</h2>' + blocks;
}

export function buildDailyPage({ routes, eventsByRoute, noticesByRoute = {}, nav = "", alert = "", now }) {
  const today = jstDate(now);
  const tomorrow = addDays(today, 1);

  return {
    title: '今日・明日の運航状況',
    body:
      nav +
      '<div id="daily-core">' + alert +
      '<p style="color:#555;font-size:0.9em">最終更新: ' + jst(now) + '</p>' +
      '<p>奄美大島に関係する航路の、今日と明日の発表をまとめています。' +
      '各社が発表した内容のみを掲載しており、発表がない便は平常運航の予定です。</p>' +
      dayBlock(today, routes, eventsByRoute, noticesByRoute, '今日') +
      dayBlock(tomorrow, routes, eventsByRoute, {}, '明日') +
      '<p style="color:#555;font-size:0.9em">翌日の運航可否は、前日の夕方から夜にかけて発表されることが多くなっています。' +
      'まだ発表がない場合は、時間をおいて再度ご確認ください。</p>' +
      '<hr>' +
      '<p style="font-size:0.9em;color:#555">' + DISCLAIMER + '</p>' +
      '</div>',
  };
}
