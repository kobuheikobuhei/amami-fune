// KKB（鹿児島放送）の交通情報ページから、旅客船・フェリーの欄を読む。
// 早期検知にだけ使う。ここに載る文は運航会社自身の発表ではなく、
// 「九州のりものinfo.com運営協議会」が集めたものを放送局が流している転載で、
// ページ自身も参考情報である旨を断っている。記事の根拠にはしない（confidence: "-"）。
//
// それでも見る理由は2つある。
//
//  1. 瀬戸内町の町営定期船は、公式サイトに運航状況が載らない。
//     公式Xと防災メールでしか流れず、Xは未ログインでは読めないことがある。
//     この欄には「通常運航中」「欠航」が文で載るため、唯一の自動取得経路になる。
//  2. 全社ぶんが1ページ10KB程度にまとまっており、1リクエストで足りる。
//     公式を何社も叩かずに「どこかが動いた」ことだけ先に分かる。
//
// ページはShift_JIS・携帯向けの素朴なHTMLで、構造は3つの印だけでできている。
//
//   <div style="font-size:13pt …>  会社名（公式サイトへのリンク付き）
//   <font …color:blue;>■【航路名】  航路の見出し
//   それ以降 <hr> まで                その航路の状況
//
// 印が変わったら読めなくなるが、黙って古い内容を出し続けるより、
// 何も取れないほうが安全なので、読めなければ0件を返して呼び出し側に任せる。

import { fetchText } from '../lib/fetcher.js';
import { htmlToText, shortHash, stripPhoneNumbers } from '../lib/text.js';

// 見るのは奄美に関わる欄だけ。桜島や種子島まで抱えると、
// 関係のない変化で毎回起こされることになる。
//
//   watched      公式を直接見ている。ここでの変化はログに残すだけ
//   uncovered    公式を自動取得できない。変化を知らせる値打ちがある
//   out_of_scope 名瀬に寄るが、このブログの掲載対象ではない。記録のみ
const INTEREST = [
  { match: /マリックス/, coverage: 'watched', route_id: 'marix-main' },
  { match: /マルエーフェリー/, coverage: 'watched', route_id: 'marue-main' },
  { match: /奄美海運/, coverage: 'watched', route_id: 'amamikaiun-kikai' },
  { match: /瀬戸内町/, coverage: 'uncovered', route_id: 'setouchi-kakeroma' },
  { match: /十島村/, coverage: 'out_of_scope', route_id: null },
];

// 会社名の行と航路の行。どちらも体裁で書かれているため、体裁で拾う。
const HEADINGS = /<div style="font-size:13pt[\s\S]*?<\/div>|<font style="font-weight:bold;color:blue;">[\s\S]*?<\/font>/gi;

/** 状況の本文。次の見出しか <hr> のどちらか早いほうまで */
function bodyAfter(html, from, until) {
  return html.slice(from, until).split(/<hr\b/i)[0];
}

function clean(html) {
  // 電話番号に全角のダッシュが混ざる（099-222－3141）。数字に挟まれたものだけ直す。
  // カタカナの長音符を巻き込むと「フェリー」が「フェリ-」になる。
  const text = htmlToText(html)
    .replace(/(?<=\d)[－―‐‑–—](?=\d)/g, '-');
  return stripPhoneNumbers(text)
    .replace(/お問\s*い?\s*合わせ[^\n]*|お問合せ[^\n]*|お問合わせ[^\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * ページを会社・航路ごとの塊に分ける。
 * 関心のある航路だけを返す。
 */
export function parseBlocks(html) {
  const marks = [];
  let m;
  HEADINGS.lastIndex = 0;
  while ((m = HEADINGS.exec(html)) !== null) {
    marks.push({ tag: m[0], start: m.index, end: HEADINGS.lastIndex });
  }

  const blocks = [];
  let operator = null;
  let operatorUrl = null;

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const until = marks[i + 1]?.start ?? html.length;

    if (/^<div/i.test(mark.tag)) {
      operator = htmlToText(mark.tag);
      operatorUrl = /href="([^"]+)"/i.exec(mark.tag)?.[1] ?? null;
      continue;
    }

    const interest = INTEREST.find((x) => x.match.test(operator ?? ''));
    if (!interest) continue;

    const route = htmlToText(mark.tag).replace(/^[■\s]+/, '').replace(/^【|】$/g, '');
    const text = clean(bodyAfter(html, mark.end, until));
    if (!text) continue;

    blocks.push({
      key: operator + '｜' + route,
      operator,
      operator_url: operatorUrl,
      route,
      route_id: interest.route_id,
      coverage: interest.coverage,
      text,
      hash: shortHash(text),
    });
  }

  return blocks;
}

/**
 * 前回との違い。前回が無いとき（初回）は空を返す。
 * 初回に全件を「変化」として扱うと、ただ拾い始めただけで通知が飛ぶ。
 */
export function changedBlocks(snapshot, blocks) {
  if (!snapshot) return [];
  const before = new Map((snapshot.items ?? []).map((i) => [i.guid, i.hash]));
  return blocks.filter((b) => before.get(b.key) !== b.hash);
}

export async function watchKkb(source, { userAgent }) {
  const { body: html, fetchedAt } = await fetchText(source.url, { userAgent });
  return { fetchedAt, blocks: parseBlocks(html) };
}
