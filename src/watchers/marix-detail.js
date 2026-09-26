// マリックスラインの個別ページから、船名と港ごとの状態を読み取る。
//
// RSSのタイトルには日付・方向・状態しか入っておらず、
// どの船が担当するか、どの港が条件付きかは分からない。
// 個別ページのHTMLにはそれらが構造化されて入っている。
//
//   <h1 class="heading1">2026年9月8日（火） …下り便【条件付運航】</h1>
//   <h4>クイーンコーラルクロス</h4>
//   <h2 class="…">条件付運航します</h2>
//   <div class="single firstport normal"> … <span class="port_name">鹿児島新港</span>
//   <div class="single conditional alert"> … <span class="port_name">和泊港</span>
//
// ページ先頭には「JavaScriptをオンに」という代替表示が置かれているが、
// 本文はその後ろにあり、そのまま読み取れる。
//
// 取得は新しい発表のときだけ行う。すでに台帳にあるものは取りに行かない。

import { fetchText } from '../lib/fetcher.js';

/**
 * 港の状態を判定する。港ごとに表示される文言を先に見て、class は補助にする。
 *
 * class の付け方は発表の種類で変わる。航行経路変更の便では、寄港しない港が
 * class="single no_status"、寄港する港が "route alert" になっていた。
 * class だけで判定していたため、寄港しない5港を平常と読み違えていた。
 * 画面の文言（「寄港しません」など）は読者が見るものそのものなので、こちらを優先する。
 */
function portStatus(cls, text) {
  if (/寄港しません|抜港/.test(text)) return 'no_call';
  if (/条件付/.test(text)) return 'conditional';
  if (/定刻通り|通常運航/.test(text)) return 'normal';
  if (/cancel|kekko|closed|no_status/i.test(cls)) return 'no_call';
  if (/conditional/i.test(cls)) return 'conditional';
  if (/change/i.test(cls)) return 'changed';
  if (/\bnormal\b/i.test(cls)) return 'normal';
  // 文言も class も知らない形。平常と決めつけず、分からないことを残す。
  return 'unknown';
}

function clean(s) {
  return (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
}

export async function fetchDetail(url, { userAgent }) {
  const { body } = await fetchText(url, { userAgent });

  const ship = clean((body.match(/<h4>([\s\S]{0,60}?)<\/h4>/) ?? [])[1]) || null;
  const statusText = clean((body.match(/<h2 class="has[^"]*">([\s\S]{0,80}?)<\/h2>/) ?? [])[1]) || null;

  const ports = [];
  const re = /<div class="single([^"]*)">([\s\S]*?)(?=<div class="single|<footer)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const cls = m[1].trim();
    const seg = m[2];
    const name = clean((seg.match(/class="port_name">([\s\S]*?)<\/span>/) ?? [])[1]);
    if (!name) continue;
    const island = clean((seg.match(/class="island">([\s\S]*?)<\/span>/) ?? [])[1]);
    const times = [...seg.matchAll(/class="time[^"]*">([\s\S]*?)<\/span>/g)]
      .map((x) => clean(x[1])).filter(Boolean);
    // 港の状態の文言は時刻より前にある。最後の港の後ろには
    // 「条件付運航の注意事項」などページ全体の見出しが続くため、時刻で切る。
    const label = clean(seg).split(/[入出]港\d/)[0];
    ports.push({ port: name, island, status: portStatus(cls, label), times });
  }

  // 平常でない港だけを注記にする。
  //
  // 欠航の便は全港が cancel になるが、それは「この便が無い」ことの言い換えで、
  // 港を並べても読者の役に立たない。状態そのもので伝わるため注記にしない。
  const allPorts = ports.length;
  const notes = [];
  for (const kind of ['no_call', 'conditional', 'changed']) {
    const hit = ports.filter((p) => p.status === kind);
    if (!hit.length) continue;
    if (hit.length === allPorts) continue; // 全港が同じなら便全体の状態
    // 港名はそのまま使う。「鹿児島新港」から「港」を外すと別の名前になる。
    notes.push({ kind, ports: hit.map((p) => p.port) });
  }

  return { ship, statusText, ports, port_notes: notes };
}
