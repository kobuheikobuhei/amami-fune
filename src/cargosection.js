// 貨物船の案内。
//
// 奄美群島には貨物船も定期で入っているが、発表の形式が各社まちまちで、
// 自動で追えるところまで確かめきれていない。
//
// 中途半端に自動化して取りこぼすより、公式ページへ案内するほうが確かなので、
// ここでは「公式で確認してください」とだけ伝える。

import { COLOR } from './style.js';

export function buildCargoSection(cargo = []) {
  if (!cargo.length) return '';

  const items = cargo.map((c) =>
    '<li style="margin-bottom:10px">' +
    '<a href="' + c.url + '" target="_blank" rel="noopener" ' +
    'style="color:' + COLOR.link + ';font-weight:700;font-size:1.02em;text-decoration:none">' +
    c.label + '</a>' +
    (c.ports ? '<div style="color:#374151;font-size:0.93em;line-height:1.7;overflow-wrap:anywhere">' + c.ports + '</div>' : '') +
    (c.note ? '<div style="color:' + COLOR.muted + ';font-size:0.88em;line-height:1.7">' + c.note + '</div>' : '') +
    '</li>'
  ).join('');

  return '<h2 style="margin:22px 0 6px">貨物船</h2>' +
    '<p style="font-size:0.95em;color:#374151;line-height:1.9;margin:0 0 10px">' +
    '奄美群島に発着する貨物船です。運航の状況は当サイトでは確認していません。' +
    '<strong>公式ページで確認してください。</strong></p>' +
    '<ul style="margin:0 0 18px;padding-left:1.2em;line-height:1.8">' + items + '</ul>';
}
