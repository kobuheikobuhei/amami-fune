// 航路別の常設ページ（仕様Q19）。
//
// このページが読者にとっての「今どうなっているか」の一次窓口になる。
// 平常時は記事を出さない（仕様Q22）ため、更新はここだけで行われる。
//
// 仕様Q35により、自動取得が壊れているときは平常運航に見せてはならない。
// 取得失敗中は赤字で明示し、公式サイトへの導線を前面に出す。

import { STATUS_LABEL, STATUS_COLOR } from './lib/status.js';
import { serviceRow } from './style.js';
import { jstDate } from './lib/text.js';

const DIRECTION_LABEL = { up: '上り便', down: '下り便' };

const DISCLAIMER =
  '最終的な運航可否は必ず各社公式サイトでご確認ください。当サイトは公式発表をもとに自動で情報を掲載しています。';

function jst(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function jpDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日(${w})`;
}

/** 期間があれば「9月3日(木)〜9月14日(月)」 */
function periodLabel(e) {
  const end = e.service_date_end;
  if (!end || end === e.service_date) return jpDate(e.service_date);
  return `${jpDate(e.service_date)}〜${jpDate(end)}`;
}

// 状態の語だけでは伝わりにくいものを言い換える（記事側と揃える）
const DETAIL_DISPLAY = {
  ドック: 'ドック入り',
  入渠: 'ドック入り',
  機関故障: '機関故障',
};

/** 取得失敗中の警告。健全性が悪いときだけ出す */
function failureBanner(sourceHealth, failThreshold) {
  const broken = sourceHealth.filter((h) => !h.ok && h.consecutive_failures >= failThreshold);
  if (!broken.length) return '';

  const since = broken
    .map((b) => (b.last_success ? jst(b.last_success) : '不明'))
    .sort()[0];

  return `<p style="border:3px solid #dc2626;background:#fef2f2;color:#dc2626;font-weight:bold;padding:12px;margin:0 0 16px">
自動取得に失敗しています（最終取得: ${since}）。<br>
このページの情報は最新ではない可能性があります。必ず公式サイトでご確認ください。
</p>`;
}

/**
 * 航路の常設ページを組み立てる。
 * events は当該航路の最新イベント（event_key ごとに1件）。
 */
/**
 * 継続中のお知らせ。
 * 「機関故障により当面の間運休」のように、日付では表せないが
 * 今も続いている状態を、個別の便より先に見せる。
 */
function noticeSection(notices) {
  if (!notices.length) return '';
  const items = notices.map(function (n) {
    const label = (n.detail ? DETAIL_DISPLAY[n.detail] || n.detail : null) || STATUS_LABEL[n.status];
    const ship = n.ship ? n.ship + 'は' : '';
    const since = n.since ? '（' + jpDate(n.since) + 'から）' : '';
    return '<li>' + ship + '<strong style="color:#d97706">' + label + '</strong>' + since +
      '　<a href="' + n.source_url + '" target="_blank" rel="noopener">公式</a></li>';
  }).join('');
  return '<div style="border:2px solid #d97706;background:#fffbeb;padding:10px 14px;margin:0 0 16px">' +
    '<strong>継続中のお知らせ</strong><ul style="margin:6px 0 0">' + items + '</ul></div>';
}

export function buildStatusPage({ route, operator, events, health, officialUrl, referenceLinks = [], notices = [], nav = "", alert = "", now, failThreshold = 2 }) {
  const today = jstDate(now);

  // 今日以降の便のみ。過去の欠航を現在の状態として見せない。
  // 期間の便は、終わりの日が今日以降なら「進行中」として残す。
  // ドック期間の途中でも表示から消えないようにするため。
  const upcoming = events
    .filter((e) => (e.service_date_end ?? e.service_date) >= today)
    .sort((a, b) => a.service_date.localeCompare(b.service_date));

  const banner = failureBanner(health, failThreshold);
  const isBroken = banner !== '';

  // 表組みは使わない。列幅が固定され、狭い画面で文字が詰まって読めなくなるため。
  const rows = upcoming
    .map((e) => serviceRow({
      when: periodLabel(e),
      segment: [e.origin ? e.origin + "発" : null, DIRECTION_LABEL[e.direction] ?? null]
        .filter(Boolean).join(" "),
      ship: e.ship,
      statusText: (e.detail ? DETAIL_DISPLAY[e.detail] ?? e.detail : null) ?? STATUS_LABEL[e.status],
      color: STATUS_COLOR[e.status],
      href: e.published_post?.url ?? e.source_url,
    }))
    .join('');
  const table = upcoming.length
    ? rows
    : isBroken
      ? ''
      : notices.length
        ? '<p style="color:#6b7280;line-height:1.8">上記のほかに、日を指定した欠航・ダイヤ変更の発表はありません。</p>'
        : '<p style="color:#6b7280;line-height:1.8">現在、欠航・ダイヤ変更の発表はありません（平常運航）。</p>';

  const body = `${nav}${alert}${banner}${noticeSection(notices)}<p style="color:#555;font-size:0.9em;line-height:1.7">公式の発表を確認した時刻: ${jst(now)}<br><span style="font-size:0.95em">この時刻の時点で、下記以外の発表は出ていません。</span></p>

<h2>${route.name}</h2>
${route.ships?.length ? `<p style="color:#555">運航船: ${route.ships.join(' / ')}</p>` : ''}

${table}

${route.notes ? `<h3>お知らせ</h3>\n<p>${route.notes.trim().replace(/\n/g, '<br>')}</p>` : ''}

${referenceLinks.length ? `<h3>あわせて確認できるもの</h3>
<ul>
${referenceLinks.map((l) => `<li><a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>${l.note ? `<br><span style="font-size:0.85em;color:#666">${l.note}</span>` : ''}</li>`).join('')}
</ul>
<p style="font-size:0.9em;color:#555">当サイトが監視している情報ではありません。各提供元でご確認ください。</p>` : ''}

<h3>公式情報</h3>
<p><a href="${officialUrl}" target="_blank" rel="noopener">${operator?.name ?? route.name} 公式サイト</a></p>

<hr>
<p style="font-size:0.9em;color:#555">${DISCLAIMER}</p>`;

  return { title: `${route.name} 運航状況`, body };
}
