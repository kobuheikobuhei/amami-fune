// 表示の共通部品。
//
// 読者の大半は携帯から見る。狭い画面で崩れないことを最優先にする。
//
// 表組みは使わない。列幅が固定されるため、幅の狭い画面で文字が詰まって読めなくなる。
// 代わりに、幅が足りなければ自然に折り返して縦に積み重なる作りにする。
// 画面幅ごとの切り替え（メディアクエリ）に頼らないのは、
// Blogger の記事本文では読み込まれ方が環境によって変わるため。

export const COLOR = {
  text: '#111827',
  muted: '#6b7280',
  line: '#e5e7eb',
  link: '#1d4ed8',
  panel: '#f8fafc',
};

/** 見出しと値の組。狭い画面では値が下へ回り込む */
export function field(label, value) {
  if (!value) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:2px 12px;padding:7px 0;' +
    'border-bottom:1px solid ' + COLOR.line + '">' +
    '<span style="color:' + COLOR.muted + ';min-width:5.5em;font-size:0.95em">' + label + '</span>' +
    '<span style="font-weight:600;flex:1;min-width:12em">' + value + '</span>' +
    '</div>';
}

/** 状態の札。色で一目で分かるようにする */
export function chip(text, color) {
  return '<span style="display:inline-block;background:' + color + ';color:#fff;' +
    'border-radius:4px;padding:2px 9px;font-weight:bold;font-size:0.95em;' +
    'white-space:nowrap">' + text + '</span>';
}

/** 押しやすい大きさのリンク */
export function link(href, text, color) {
  return '<a href="' + href + '" style="display:inline-block;padding:6px 0;' +
    'color:' + (color || COLOR.link) + ';font-weight:600;text-decoration:none">' + text + '</a>';
}

/** 囲み。左端の色帯で種類を示す */
export function card(inner, accent) {
  return '<div style="border:1px solid ' + COLOR.line + ';border-left:5px solid ' + accent +
    ';border-radius:8px;padding:12px 14px;margin:0 0 14px;background:#fff">' + inner + '</div>';
}

/** 便を1件ぶん示す行。日付・区間・状態が縦に積み重なる */
export function serviceRow({ when, segment, ship, statusText, color, href }) {
  const head = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:2px">' +
    '<strong style="font-size:1.02em">' + when + '</strong>' +
    chip(statusText, color) +
    '</div>';

  const detail = [ship, segment].filter(Boolean).join('　');
  const body = detail
    ? '<div style="color:#374151;font-size:0.97em;overflow-wrap:anywhere">' + detail + '</div>'
    : '';

  const more = href ? '<div>' + link(href, '詳しく見る') + '</div>' : '';

  return '<div style="padding:10px 0;border-bottom:1px solid ' + COLOR.line + '">' +
    head + body + more + '</div>';
}

/** 港の並び。折り返せるようにする */
export function portChain(ports, marks = {}) {
  const MARK_COLOR = { conditional: '#d97706', no_call: '#dc2626', changed: '#d97706' };
  const MARK_TEXT = { conditional: '※', no_call: '×', changed: '※' };

  return '<div style="line-height:2.1;overflow-wrap:anywhere">' +
    ports.map((p) => {
      const kind = marks[p];
      if (!kind) {
        return '<span style="display:inline-block;padding:1px 2px">' + p + '</span>';
      }
      const c = MARK_COLOR[kind] || '#d97706';
      return '<span style="display:inline-block;padding:1px 4px;border-radius:4px;' +
        'background:#fff7ed;color:' + c + ';font-weight:bold">' + p + (MARK_TEXT[kind] || '') + '</span>';
    }).join('<span style="color:#cbd5e1"> ▸ </span>') +
    '</div>';
}
