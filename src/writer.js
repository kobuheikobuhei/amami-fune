// 記事の生成。
//
// 仕様Q25により、公式発表文のコピペはしない。
// 台帳に持っている構造化された事実（運航日・出発港・方向・船・状態）から
// こちら側の言葉で組み立て、根拠として公式リンクを必ず添える。

import { STATUS_LABEL, STATUS_COLOR } from './lib/status.js';
import { field, chip, card, portChain, COLOR } from './style.js';

const OPERATOR_LABEL = {
  marue: 'マルエーフェリー',
  marix: 'マリックスライン',
  amamikaiun: '奄美海運',
  setouchi: '瀬戸内町営定期船',
  kyodogumi: '共同組海運',
};

const OPERATOR_ROMAJI = {
  marue: 'marue',
  marix: 'marix',
  amamikaiun: 'amamikaiun',
  setouchi: 'setouchi',
  kyodogumi: 'kyodogumi',
};

const SHIP_ROMAJI = {
  フェリーあけぼの: 'akebono',
  フェリー波之上: 'naminoue',
  フェリーきかい: 'kikai',
  フェリーあまみ: 'famami',
};

const STATUS_ROMAJI = {
  cancelled: 'kesshin',
  extra: 'daiyahenko',
  resumed: 'saikai',
  conditional: 'jokentsuki',
  undecided: 'mitei',
  normal: 'heijo',
};

const PORT_ROMAJI = {
  鹿児島新港: 'kagoshima',
  鹿児島本港北埠頭: 'kagoshima',
  鹿児島: 'kagoshima',
  名瀬: 'naze',
  古仁屋: 'koniya',
  喜界: 'kikai',
  亀徳: 'kametoku',
  和泊: 'wadomari',
  与論: 'yoron',
  本部: 'motobu',
  那覇: 'naha',
  平土野: 'hetono',
  知名: 'china',
  徳之島: 'tokuno',
  沖永良部: 'erabu',
  谷山: 'taniyama',
};

const DIRECTION_LABEL = { up: '上り便', down: '下り便' };
const DIRECTION_ROMAJI = { up: 'n', down: 'k' };

const DISCLAIMER =
  '最終的な運航可否は必ず各社公式サイトでご確認ください。当サイトは公式発表をもとに自動で情報を掲載しています。';

function mmdd(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 期間があれば「9/3〜9/14」、なければ「9/3」 */
function periodShort(event) {
  const end = event.service_date_end;
  if (!end || end === event.service_date) return mmdd(event.service_date);
  return `${mmdd(event.service_date)}〜${mmdd(end)}`;
}

/** 期間があれば「2026年9月3日(木)〜9月14日(月)」 */
function periodLong(event) {
  const end = event.service_date_end;
  if (!end || end === event.service_date) return jpDate(event.service_date);
  const [, em, ed] = end.split('-').map(Number);
  const [ey] = end.split('-').map(Number);
  const w2 = '日月火水木金土'[new Date(Date.UTC(ey, em - 1, ed)).getUTCDay()];
  return `${jpDate(event.service_date)}〜${em}月${ed}日(${w2})`;
}

// 状態の語だけでは読者に伝わりにくいものを言い換える。
// 「ドック」だけでは何が起きるのか分からないため。
const DETAIL_DISPLAY = {
  ドック: 'ドック入り',
  入渠: 'ドック入り',
  機関故障: '機関故障',
};

function detailText(event) {
  const d = event.detail;
  if (!d) return null;
  return DETAIL_DISPLAY[d] ?? d;
}

function jpDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日(${w})`;
}

/** 仕様Q21: 【日付】船社・状態｜区間 */
export function buildTitle(event) {
  const op = OPERATOR_LABEL[event.operator_id] ?? event.operator_id ?? '';
  const status = detailText(event) ?? STATUS_LABEL[event.status];
  const segment = [
    event.origin ? `${event.origin}発` : null,
    DIRECTION_LABEL[event.direction] ?? null,
  ]
    .filter(Boolean)
    .join(' ');
  // 読者は船名で覚えている（「あけぼの、今日出るの？」）ため船名を先頭に置く。
  // 船名が分からない発表では船社名を先頭にする。
  const head = event.ship ?? op;
  const tail = segment || (event.ship ? op : null);
  return `【${periodShort(event)}】${head} ${status}${tail ? `｜${tail}` : ''}`;
}

/** 仕様Q27: 日付＋船社＋状態のローマ字 */
export function buildPermalink(event) {
  // BloggerはタイトルからURLを生成し、約39文字で切る。
  // 切られた結果が重複しないよう、こちらで短く確定的に作る。
  const endPart =
    event.service_date_end && event.service_date_end !== event.service_date
      ? event.service_date_end.replace(/-/g, '').slice(4)
      : null;
  const parts = [
    event.service_date.replace(/-/g, ''),
    endPart,
    (event.ship ? SHIP_ROMAJI[event.ship] : null) ?? OPERATOR_ROMAJI[event.operator_id] ?? 'unknown',
    STATUS_ROMAJI[event.status] ?? 'info',
    event.origin ? PORT_ROMAJI[event.origin] ?? null : null,
    DIRECTION_ROMAJI[event.direction] ?? null,
  ].filter(Boolean);

  let slug = parts.join('-');
  if (slug.length > 39) slug = slug.slice(0, 39).replace(/-+$/, '');
  return slug;
}

/** 仕様Q23: 航路＋船社＋状態の3軸 */
export function buildLabels(event, route) {
  return [route?.name ?? event.route_id, OPERATOR_LABEL[event.operator_id], STATUS_LABEL[event.status]]
    .filter(Boolean);
}

/**
 * 同じ発表に含まれていた他の便。
 * ドック入りの発表には運航再開の予定日と出発港が併記されるなど、
 * 読者が最も知りたい情報が同じ発表の別の行に書かれていることが多い。
 */
function relatedSection(event) {
  const rel = event.related ?? [];
  if (!rel.length) return '';

  const items = rel
    .map((r) => {
      const when = r.service_date_end && r.service_date_end !== r.service_date
        ? `${jpDate(r.service_date)}〜${jpDate(r.service_date_end)}`
        : jpDate(r.service_date);
      const label = (r.detail ? DETAIL_DISPLAY[r.detail] ?? r.detail : null) ?? STATUS_LABEL[r.status];
      const seg = [r.origin ? `${r.origin}発` : null, DIRECTION_LABEL[r.direction] ?? null]
        .filter(Boolean).join(' ');
      const color = STATUS_COLOR[r.status];
      return `<li>${when} <strong style="color:${color}">${label}</strong>${seg ? `（${seg}）` : ''}</li>`;
    })
    .join('\n');

  return `<h3>同じ発表に含まれる情報</h3>
<ul>
${items}
</ul>

`;
}

/**
 * 寄港地に関する注記。
 * 臨時便が一部の港を飛ばす場合、乗る側にとっては欠航と同じくらい重要な情報になる。
 * 公式の文面は転載せず、拾った港名からこちらの言葉で組み立てる（仕様Q25）。
 */
function portNotesSection(event) {
  const notes = event.port_notes ?? [];
  if (!notes.length) return '';

  const items = notes
    .map((n) => {
      const ports = n.ports.join('・');
      if (n.kind === 'no_call') {
        return '<li>この発表の便は <strong>' + ports + '</strong> には寄港しません</li>';
      }
      if (n.kind === 'conditional') {
        return '<li><strong>' + ports + '</strong> は条件付き寄港です' +
          '（抜港・港の変更・入出港時刻の変更が生じる場合があります）</li>';
      }
      return '<li>寄港地の変更があります（' + ports + '）</li>';
    })
    .join('');

  return '<h3>寄港地について</h3>' +
    '<ul>' + items + '</ul>' +
    '<p style="font-size:0.9em;color:#555">対象となる便の詳細は公式発表をご確認ください。</p>';
}

function revisionHistory(event) {
  const revs = event.revisions ?? [];
  if (revs.length <= 1) return '';
  const rows = revs
    .map((r) => {
      const t = new Date(r.at).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      const label = r.detail ?? STATUS_LABEL[r.status];
      return `<li>${t} ${label}</li>`;
    })
    .join('\n');
  return `<h3>更新履歴</h3>\n<ul>\n${rows}\n</ul>`;
}

export function buildBody(event, { route, correction = null, nav = "" }) {
  const op = OPERATOR_LABEL[event.operator_id] ?? event.operator_id;
  const statusLabel = STATUS_LABEL[event.status];
  const detailWord = detailText(event);
  const color = STATUS_COLOR[event.status];
  const isPeriod = event.service_date_end && event.service_date_end !== event.service_date;

  const correctionBlock = correction
    ? '<p style="color:#dc2626;font-weight:bold">【訂正】' + correction + '</p>'
    : '';

  // 結論を最初に置く。携帯では画面に入る範囲が狭いため、
  // 状態と対象の便が一目で分かるようにする。
  const lead = card(
    '<div style="margin-bottom:6px">' + chip(detailWord ?? statusLabel, color) + '</div>' +
    '<div style="font-size:1.05em;font-weight:600;line-height:1.6">' +
    periodLong(event) + '</div>' +
    '<div style="color:#374151;margin-top:4px;overflow-wrap:anywhere">' +
    op + (event.ship ? '「' + event.ship + '」' : '') + '</div>',
    color
  );

  const facts =
    field(isPeriod ? '対象期間' : '運航日', periodLong(event)) +
    field('状態', detailWord && detailWord.replace(/き/g, '') !== statusLabel.replace(/き/g, '')
      ? statusLabel + '（' + detailWord + '）' : statusLabel) +
    field('船社', op) +
    field('船名', event.ship) +
    field('出発港', event.origin) +
    field('方向', DIRECTION_LABEL[event.direction]);

  return nav + correctionBlock + lead +
    facts +
    routeSection(event, route) +
    relatedSection(event) +
    '<h3>公式発表</h3>' +
    '<p><a href="' + event.source_url + '" target="_blank" rel="noopener" ' +
    'style="color:' + COLOR.link + ';font-weight:600">' + event.source_title +
    '（' + op + ' 公式）</a></p>' +
    revisionHistory(event) +
    '<hr>' +
    '<p style="font-size:0.9em;color:#555;line-height:1.7">' + DISCLAIMER + '</p>';
}

export function buildArticle(event, { route, correction = null, nav = "" }) {
  return {
    title: buildTitle(event),
    permalink: buildPermalink(event),
    labels: buildLabels(event, route),
    body: buildBody(event, { route, correction, nav }),
  };
}

/**
 * 航路の寄港地を並べて示す。
 *
 * 公式サイトは船名の直下に必ず航路を表示している
 * （例: フェリー波之上 / 鹿児島 - 名瀬 - 亀徳 - 和泊 - 与論 - 本部 - 那覇）。
 * どこを回る船なのかが分からないと、読者は自分の行き先が関係するか判断できない。
 * 影響のある港が分かっている場合は、その並びの中で目立たせる。
 */
/**
 * 航路の寄港地を並べて示す。
 *
 * 公式サイトは船名の直下に必ず航路を表示している。
 * どこを回る船なのかが分からないと、読者は自分の行き先が関係するか判断できない。
 * 影響のある港が分かっている場合は、その並びの中で目立たせる。
 *
 * 携帯では横一列に収まらないため、折り返せる作りにしている。
 */
function routeSection(event, route) {
  const ports = route?.ports ?? [];
  if (!ports.length) return '';

  const ordered = event.direction === "up" ? [...ports].reverse() : [...ports];

  // 航路の並びと注記で港名の表記が揃わないことがある。
  // 公式は「亀徳港」、航路の定義は「亀徳」と書く。前方一致で対応づける。
  const marks = {};
  for (const n of event.port_notes ?? []) {
    for (const noted of n.ports) {
      const hit = ordered.find((p) => noted === p || noted.startsWith(p));
      if (hit && !marks[hit]) marks[hit] = n.kind;
    }
  }

  const legend = (event.port_notes ?? []).map((n) => {
    const list = n.ports.join('・');
    if (n.kind === 'no_call') {
      return '<li><span style="color:#dc2626">×</span> <strong>' + list + '</strong> には寄港しません</li>';
    }
    if (n.kind === 'conditional') {
      return '<li><span style="color:#d97706">※</span> <strong>' + list +
        '</strong> は条件付き寄港です（抜港・港の変更・入出港時刻の変更が生じる場合があります）</li>';
    }
    return '<li><span style="color:#d97706">※</span> <strong>' + list + '</strong> は寄港地が変更される場合があります</li>';
  }).join('');

  const dirLabel = event.direction ? '（' + DIRECTION_LABEL[event.direction] + '）' : '';

  return '<h3>航路' + dirLabel + '</h3>' +
    portChain(ordered, marks) +
    (legend ? '<ul style="line-height:1.9">' + legend + '</ul>' : '') +
    '<p style="font-size:0.9em;color:#555;line-height:1.7">平常時の寄港地です。実際の寄港は公式発表をご確認ください。</p>';
}
