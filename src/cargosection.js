// 貨物船の案内。
//
// 奄美群島には貨物船も定期で入っている。旅客は乗船できないが、
// 荷物や宅配の遅れに直結するため、読者にとっては運航状況の一部になる。
//
// 発表の形式は会社ごとにまちまちで、自動で追えるところまで確かめられた
// ものと、そうでないものがある。追えていないものを追えているかのように
// 並べるのがいちばん危ういので、1件ずつどちらなのかを書き分ける。

import { COLOR } from './style.js';

export function buildCargoSection(cargo = [], pageIds = {}) {
  if (!cargo.length) return '';

  const items = cargo.map((c) => {
    const page = c.route_id ? pageIds[c.route_id]?.url : null;

    const status = page
      ? '<div style="color:#166534;font-size:0.9em;line-height:1.7">' +
        '公式の発表を確認し、このサイトにも掲載しています　' +
        '<a href="' + page + '" style="color:' + COLOR.link + ';font-weight:600">運航状況</a></div>'
      : '<div style="color:#b45309;font-size:0.9em;line-height:1.7">' +
        'このサイトでは確認していません。<strong>公式ページで確認してください。</strong></div>';

    return '<li style="margin-bottom:12px">' +
      '<a href="' + c.url + '" target="_blank" rel="noopener" ' +
      'style="color:' + COLOR.link + ';font-weight:700;font-size:1.02em;text-decoration:none">' +
      c.label + '</a>' +
      (c.ports ? '<div style="color:#374151;font-size:0.93em;line-height:1.7;overflow-wrap:anywhere">' + c.ports + '</div>' : '') +
      status +
      '</li>';
  }).join('');

  return '<h2 style="margin:22px 0 6px">貨物船</h2>' +
    '<p style="font-size:0.95em;color:#374151;line-height:1.9;margin:0 0 10px">' +
    '奄美群島に発着する貨物船です。旅客は乗船できません。</p>' +
    '<ul style="margin:0 0 18px;padding-left:1.2em;line-height:1.8">' + items + '</ul>';
}
