// 対象範囲の明示。
//
// 掲載していない航路について、読者が「発表がない＝平常運航」と
// 受け取ってしまうのが最も危険な誤解になる。
// 何を見ていて何を見ていないかを、はっきり書いておく。

/** 監視している船社と、していない船社を routes.yml から機械的に導く */
export function buildScopeNotice({ routes = [], routeIds = new Set(), operators = {} }) {
  // 船社ごとにまとめる。同じ会社が複数の航路を持つため、
  // 航路のまま並べると同じ名前が繰り返される。
  const uniq = (list) => [...new Set(list.map((r) => r.operator_id))].filter(Boolean);

  const coveredOperators = uniq(routes.filter((r) => routeIds.has(r.id)));
  if (!coveredOperators.length) return '';

  const notCoveredOperators = uniq(
    routes.filter((r) => !routeIds.has(r.id) && r.enabled)
  ).filter((id) => !coveredOperators.includes(id));

  const list = (ids) =>
    '<ul style="line-height:2;margin:6px 0 0">' +
    ids.map((id) => {
      const op = operators[id];
      const name = op?.name ?? id;
      const label = op?.site
        ? '<a href="' + op.site + '" target="_blank" rel="noopener" style="color:#1d4ed8">' + name + '</a>'
        : name;
      return '<li>' + label + '</li>';
    }).join('') +
    '</ul>';

  return '<h2 style="margin:26px 0 8px">このサイトが見ている範囲</h2>' +
    '<p style="line-height:1.9">次の船社の公式発表を自動で確認し、掲載しています。</p>' +
    list(coveredOperators) +
    (notCoveredOperators.length
      ? '<p style="line-height:1.9;margin-top:16px">' +
        '<strong>次の船社は掲載していません。</strong><br>' +
        'このサイトに発表が出ていなくても、平常運航とは限りません。' +
        '各社の公式サイトでご確認ください。</p>' +
        list(notCoveredOperators)
      : '');
}
