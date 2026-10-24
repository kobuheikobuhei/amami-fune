// マルエーフェリー・奄美海運（A"LINE）のRSSを正規化する。
//
// このサイトの記事は1本の中に複数の便と複数の状態が同居する。
// 例:「欠航案内」の本文に【欠航便】と【臨時便】の両方が入る。
// そのため記事単位ではなく行単位で解析し、
//   1. 行そのものに状態語があればそれを採用する
//   2. なければ直前の見出し（【欠航便】《運航スケジュール変更のご案内》など）の状態を継ぐ
//   3. それも無ければ記事タイトルの状態を使う
// という優先順位で状態を決める。
//
// 日付は「9月3日～9月14日」のような期間になることがある（ドック入りなど）。
// 期間を2つの独立した日として扱うと間の日が抜け落ちるため、期間は1件として保持する。
//
// 船は記事URLのスラッグから確実に特定できる。

import { fetchFeed } from '../lib/rss.js';
import {
  htmlToText, extractDateUnits, extractDirection, extractOrigin, shortHash,
  stripPhoneNumbers, cutContactBlock, extractPortNotes,
} from '../lib/text.js';
import { classify, detailLabel, detailPhrase } from '../lib/status.js';

const SHIP_BY_SLUG = {
  'ferry-akebono': 'フェリーあけぼの',
  'ferry-naminoue': 'フェリー波之上',
  'ferry-kikai': 'フェリーきかい',
  'ferry-amami': 'フェリーあまみ',
};

const ROUTE_BY_SLUG = {
  'route-kagoshima': { routeId: 'marue-main', operatorId: 'marue' },
  'route-amami': { routeId: 'amamikaiun-kikai', operatorId: 'amamikaiun' },
};

function parseLink(link) {
  const shipSlug = Object.keys(SHIP_BY_SLUG).find((s) => link.includes(`/${s}/`));
  const routeSlug = Object.keys(ROUTE_BY_SLUG).find((s) => link.includes(`/${s}/`));
  return {
    ship: shipSlug ? SHIP_BY_SLUG[shipSlug] : null,
    ...(routeSlug ? ROUTE_BY_SLUG[routeSlug] : { routeId: null, operatorId: null }),
  };
}

/** 行中の最後の見出し【…】《…》を返す */
function headingIn(line) {
  const matches = [...line.matchAll(/[【《]([^】》]{1,20})[】》]/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** 寄港時刻の行。「那覇港 /22:00(出港)」「名瀬港 8:30(入港)/21:20(出港)」 */
const TIMETABLE_LINE = /\d{1,2}[:：]\d{2}\s*[（(](入港|出港|着|発)[)）]/;
/** 着く時刻を含む行。「喜界4:30着/5:00発」「名瀬港 8:30(入港)」 */
const ARRIVAL_LINE = /\d{1,2}[:：]\d{2}\s*([（(](入港|着)[)）]|着)/;

/**
 * 便の行の次に状態だけを置く書式を読む。
 *
 * マルエーフェリーの発表は便と状態を2列の表で並べるため、本文を行にすると
 * 「10月23日(金)07:00那覇港発 上り便」「欠航」と分かれる。便の行だけを見て
 * 題名に落ちると、題名が古いまま本文が欠航に書き換わった発表で、
 * 欠航の便を条件付き運航として出してしまう。実際に起きた。
 *
 * 他社の書式を巻き込まないよう、条件は狭く取る。日付を含まない短い行で、
 * 状態の語から成るものに限る。文章の中に出てくる語は拾わない。
 */
const STATUS_ONLY_MAX = 12;

function statusOnlyLine(line, baseDate) {
  if (!line || line.length > STATUS_ONLY_MAX) return null;
  if (extractDateUnits(line, baseDate).length) return null;
  return classify(line);
}

/**
 * 本文を行単位で解析し、便ごとの状態を取り出す。
 * 日付を含まない行はイベントにしない（事実が特定できないため）。
 */
export function parseBody(bodyText, { baseDate, titleStatus }) {
  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];
  let headingStatus = null;
  // 便の見出し行（「9月26日(土)上り便 フェリーあけぼの」）の後には、
  // その便の寄港時刻が1港1行で続く（「9月28日(月)鹿児島新港 8:30(入港)」）。
  // これは同じ便の途中経過で、別の便ではない。便として拾うと「9/28 鹿児島新港発」
  // のような存在しない便ができてしまう。
  let underVoyage = false;
  let seenDated = false;
  // 見出し（【臨時便(下り)】など）で区切った塊。寄港しない港の注記は、
  // 同じ塊の便にだけ当てはまる。発表全体に当てると、下りの臨時便だけが
  // 寄らない港を、同じ発表の上りの臨時便にまで「寄港しません」と書いてしまう。
  let block = 0;
  let blockDirection = null;
  let blockHeading = '';
  const blockNotes = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = headingIn(line);
    if (heading) {
      const hs = classify(heading);
      if (hs) headingStatus = hs;
      underVoyage = false;
      block += 1;
      blockDirection = extractDirection(heading);
      blockHeading = heading;
    }

    const notes = extractPortNotes(line);
    if (notes.length) blockNotes.set(block, [...(blockNotes.get(block) ?? []), ...notes]);

    const units = extractDateUnits(line, baseDate);
    if (units.length === 0) continue;

    // 「10月6日(火)和泊港 抜港」のように、寄らない港を日付付きで並べる行がある。
    // 時刻が無いため寄港時刻の行としては外れず、便として拾うと
    // 「和泊発の便」という、実際には寄りもしない便の記事ができてしまう。
    // 上で寄港地の注記として記録済みなので、便にはしない。
    if (notes.length && !/便/.test(line)) continue;

    if (underVoyage && TIMETABLE_LINE.test(line) && !/便/.test(line)) continue;
    // 奄美海運は見出しを置かずに「9/18(金) 鹿児島本港北埠頭17:30発」
    // 「9/19(土) 喜界4:30着/5:00発」と並べる。着く時刻を含む行は、上に書かれた便の
    // 途中の港か終着で、新しい便の出発ではない。発の時刻だけの行（欠航便の列挙など）は
    // それぞれ別の便なので、ここでは外さない。
    if (seenDated && ARRIVAL_LINE.test(line) && !/便/.test(line)) continue;
    seenDated = true;
    if (units.length === 1 && /[上下]り便|臨時便/.test(line)) underVoyage = true;

    // 行そのもの → すぐ下の状態だけの行 → 見出し → 題名 の順に確かめる。
    // 題名は発表が書き換わっても直されないことがあり、いちばん当てにならない。
    const nextLine = statusOnlyLine(lines[i + 1], baseDate) ? lines[i + 1] : null;
    const status = classify(line) ?? classify(nextLine ?? '') ?? headingStatus ?? titleStatus;
    if (!status) continue;

    // 情報の確かさを点数化する。
    // 1行に日付の塊が2つ以上あるのは「それに伴い9月5日…ならびに9月6日…」のような
    // 要約文で、どの便がどの状態か対応づけられない。期間（9月3日～9月14日）は
    // 塊が1つなので曖昧ではない。
    const specificity = units.length > 1 ? 1 : heading ? 3 : 2;

    for (const u of units) {
      entries.push({
        service_date: u.from,
        service_date_end: u.to ?? null,
        status,
        direction: specificity === 1 ? null : extractDirection(line) ?? blockDirection,
        origin: specificity === 1 ? null : extractOrigin(line),
        // 一覧の行には「臨時便」の語が無く、塊の見出し【臨時便(下り)】にだけある。
        detail: detailPhrase(line, status) ?? detailPhrase(nextLine ?? '', status) ??
          detailPhrase(heading ?? '', status) ??
          (specificity === 1 ? null : detailPhrase(blockHeading, status)) ?? null,
        specificity,
        line,
        block,
      });
    }
  }

  // 同じ日付・同じ状態については、最も確実な行から得たものだけを残す。
  // これにより要約文由来の誤った方向が、見出し付きの行に負けて消える。
  const maxSpec = new Map();
  for (const e of entries) {
    const k = `${e.service_date}|${e.service_date_end ?? ''}|${e.status}`;
    maxSpec.set(k, Math.max(maxSpec.get(k) ?? 0, e.specificity));
  }

  // 要約文（日付が2つ以上ある行）は、どの日がどの状態か分からない。
  // 「欠航に伴い、9月28日…9月30日…で臨時便を運航」は欠航の語を含むが、
  // 2つの日付は臨時便の日。同じ日を一覧の行が明示していれば、状態が違っても一覧に従う。
  const specificDates = new Set(
    entries.filter((e) => e.specificity >= 2).map((e) => `${e.service_date}|${e.service_date_end ?? ''}`)
  );

  // 便の無い塊に書かれた注記（《寄港地について》の下など）は、どの便のことか
  // 決められないため、これまでどおり発表の全ての便に当てる。
  const entryBlocks = new Set(entries.map((e) => e.block));
  const sharedNotes = [...blockNotes].filter(([b]) => !entryBlocks.has(b)).flatMap(([, n]) => n);

  const kept = new Map();
  for (const e of entries) {
    const k = `${e.service_date}|${e.service_date_end ?? ''}|${e.status}`;
    if (e.specificity < maxSpec.get(k)) continue;
    if (e.specificity === 1 && specificDates.has(`${e.service_date}|${e.service_date_end ?? ''}`)) continue;
    const key = `${k}|${e.origin ?? ''}|${e.direction ?? ''}`;
    if (kept.has(key)) continue;
    const { block: b, ...rest } = e;
    kept.set(key, { ...rest, port_notes: [...(blockNotes.get(b) ?? []), ...sharedNotes] });
  }

  // 同じ便を、出発港の分かる行と分からない行の両方から拾うことがある。
  // 「10月5日(月)07:00那覇港発 上り便」と
  // 「※10月5日上り便は抜港の可能性が高い条件付き運航となります。」のような
  // 補足文がその例。台帳の鍵に出発港が入るため、別の便として記事が2本できる。
  // 同じ日・同じ状態・同じ方向なら、出発港の分かっている側だけを残す。
  const hasOrigin = new Set();
  for (const e of kept.values()) {
    if (e.origin) hasOrigin.add(`${e.service_date}|${e.service_date_end ?? ''}|${e.status}|${e.direction ?? ''}`);
  }

  return [...kept.values()]
    .filter((e) => e.origin ||
      !hasOrigin.has(`${e.service_date}|${e.service_date_end ?? ''}|${e.status}|${e.direction ?? ''}`))
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
}

export async function watchAline(source, { userAgent }) {
  const { items, fetchedAt } = await fetchFeed(source.url, { userAgent });

  const observations = items.map((item) => {
    const body = cutContactBlock(stripPhoneNumbers(htmlToText(item.contentHtml)));
    const { ship, routeId, operatorId } = parseLink(item.link);
    const baseDate = item.pubDate ?? fetchedAt;

    // 記事全体の状態はタイトルで決める。本文の付随的な語に引きずられないようにする。
    const titleStatus = classify(item.title) ?? classify(body);
    const entries = parseBody(body, { baseDate, titleStatus });

    return {
      source_id: source.id,
      operator_id: operatorId ?? source.operator_id,
      route_id: routeId ?? source.route_ids?.[0] ?? null,
      ship,
      status: titleStatus,
      detail: detailPhrase(item.title, titleStatus) ?? detailPhrase(body, titleStatus),
      entries,
      port_notes: extractPortNotes(body),
      service_dates: [...new Set(entries.map((e) => e.service_date))].sort(),
      title: item.title,
      link: item.link,
      guid: item.guid,
      published_at: item.pubDate,
      summary: body.slice(0, 600),
      body_hash: shortHash(body),
      confidence: 'A',
    };
  });

  return { fetchedAt, observations };
}
