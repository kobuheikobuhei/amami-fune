// ページ間の案内。
//
// 読者はどのページから入ってくるか分からない。
// 古い欠航の記事に検索でたどり着いた人が、そこから「今の状況」へ移れないと
// 古い情報だけを持ち帰ることになる。全てのページと記事の先頭に置く。

const ORDER = [
  { key: '__daily', label: '今日・明日の運航状況' },
  { key: '__typhoon', label: '台風情報' },
];

/**
 * pages: { キー: { id, url } } の形。URLが分かっているものだけを出す。
 * current: いま作っているページのキー。そこはリンクにしない。
 */
export function buildNav(pages = {}, routes = [], current = null) {
  const items = [];

  for (const { key, label } of ORDER) {
    const url = pages[key]?.url;
    if (!url) continue;
    items.push({ key, label, url });
  }

  for (const route of routes) {
    const url = pages[route.id]?.url;
    if (!url) continue;
    // 航路名は長いので、船社名の部分だけを出す
    const m = route.name.match(/（(.+)）/);
    items.push({ key: route.id, label: m ? m[1] : route.name, url });
  }

  if (items.length < 2) return '';

  const links = items
    .map((it) =>
      it.key === current
        ? '<span style="display:inline-block;padding:4px 8px;color:#111;font-weight:bold">' + it.label + '</span>'
        : '<a href="' + it.url + '" style="display:inline-block;padding:4px 8px;color:#1d4ed8;text-decoration:none">' + it.label + '</a>'
    )
    .join('<span style="color:#cbd5e1"> ｜ </span>');

  return '<nav style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;' +
    'padding:8px 12px;margin:0 0 16px;font-size:0.95em;line-height:1.9">' +
    links + '</nav>';
}

/** 記事の先頭に置く、現在の状況への案内 */
export function buildArticleNav(pages = {}) {
  const daily = pages.__daily?.url;
  if (!daily) return '';
  return '<p style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;' +
    'padding:8px 12px;margin:0 0 16px;font-size:0.95em">' +
    'この記事は発表時点の内容です。最新の状況は' +
    '<a href="' + daily + '" style="color:#1d4ed8">今日・明日の運航状況</a>' +
    'でご確認ください。</p>';
}
