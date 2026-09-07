// 台風の進路図を自分で描く。
//
// 気象庁も米海軍も、画像として取り出せる進路図は提供していない
// （気象庁はブラウザ上で描画、米海軍はプログラムからのアクセスを拒否）。
// ただし座標データは気象庁から取得できるので、それを使って自前で描く。
//
// 自前で描く利点は、公式の図には無い「航路」を重ねられること。
// 台風が航路のどのあたりにあるのかが一目で分かる。
//
// 出典: 気象庁（https://www.jma.go.jp/）

// 主要港のおおよその位置。概略図なので精密な測地は行わない。
export const PORT_COORDS = {
  鹿児島: [31.60, 130.56],
  名瀬: [28.38, 129.49],
  古仁屋: [28.15, 129.32],
  喜界: [28.32, 129.94],
  亀徳: [27.82, 128.93],
  和泊: [27.40, 128.66],
  与論: [27.05, 128.44],
  本部: [26.65, 127.88],
  那覇: [26.21, 127.67],
  平土野: [27.85, 128.89],
  知名: [27.35, 128.58],
};

const W = 640;
const H = 560;
const PAD = 44;

function projector(bounds) {
  const { minLat, maxLat, minLon, maxLon } = bounds;
  // 緯度による経度の縮みを反映して、形が極端に歪まないようにする
  const latSpan = Math.max(maxLat - minLat, 0.5);
  const lonSpan = Math.max(maxLon - minLon, 0.5);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const sx = (W - PAD * 2) / (lonSpan * lonScale);
  const sy = (H - PAD * 2) / latSpan;
  const s = Math.min(sx, sy);

  const cx = (minLon + maxLon) / 2;
  const cy = (minLat + maxLat) / 2;

  return (lat, lon) => [
    W / 2 + (lon - cx) * lonScale * s,
    H / 2 - (lat - cy) * s,
  ];
}

function boundsOf(points) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return {
    minLat: Math.min(...lats) - 0.6,
    maxLat: Math.max(...lats) + 0.6,
    minLon: Math.min(...lons) - 0.6,
    maxLon: Math.max(...lons) + 0.6,
  };
}

/**
 * 台風の進路と航路を重ねた概略図を返す。
 * typhoon: watchTyphoon の結果1件
 * routePorts: 航路の寄港地名の配列
 * track: forecast.json から取り出した過去の経路（[[lat,lon], ...]）
 */
export function buildTrackSvg({ typhoon, routePorts = [], track = [] }) {
  const portPoints = routePorts
    .map((name) => (PORT_COORDS[name] ? { name, lat: PORT_COORDS[name][0], lon: PORT_COORDS[name][1] } : null))
    .filter(Boolean);

  const all = [...portPoints.map((p) => [p.lat, p.lon]), ...track];
  if (typhoon?.position) all.push([typhoon.position.lat, typhoon.position.lon]);
  for (const f of typhoon?.forecasts ?? []) {
    if (f.position) all.push([f.position.lat, f.position.lon]);
  }
  if (all.length < 2) return '';

  const project = projector(boundsOf(all));

  // 航路
  const routeLine = portPoints
    .map((p) => project(p.lat, p.lon).join(','))
    .join(' ');
  const routeDots = portPoints
    .map((p) => {
      const [x, y] = project(p.lat, p.lon);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="#1d4ed8"/>' +
        '<text x="' + (x + 7).toFixed(1) + '" y="' + (y + 4).toFixed(1) +
        '" font-size="12" fill="#1e3a8a">' + p.name + '</text>';
    })
    .join('');

  // これまでの経路
  const past = track.length
    ? '<polyline points="' + track.map((t) => project(t[0], t[1]).join(',')).join(' ') +
      '" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="5 4"/>'
    : '';

  // 現在位置
  let current = '';
  if (typhoon?.position) {
    const [x, y] = project(typhoon.position.lat, typhoon.position.lon);
    current =
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="13" fill="#dc2626" fill-opacity="0.25"/>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6" fill="#dc2626"/>' +
      '<text x="' + (x + 10).toFixed(1) + '" y="' + (y - 10).toFixed(1) +
      '" font-size="13" font-weight="bold" fill="#b91c1c">現在</text>';
  }

  // 予報
  const forecasts = (typhoon?.forecasts ?? [])
    .filter((f) => f.position)
    .map((f) => {
      const [x, y] = project(f.position.lat, f.position.lon);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="10" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="4 3"/>' +
        '<text x="' + (x + 12).toFixed(1) + '" y="' + (y + 4).toFixed(1) +
        '" font-size="11" fill="#b45309">' + f.hours + 'h</text>';
    })
    .join('');

  const forecastLine = (typhoon?.forecasts ?? []).filter((f) => f.position).length && typhoon?.position
    ? '<polyline points="' +
      [project(typhoon.position.lat, typhoon.position.lon).join(',')]
        .concat(typhoon.forecasts.filter((f) => f.position).map((f) => project(f.position.lat, f.position.lon).join(',')))
        .join(' ') +
      '" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="6 4"/>'
    : '';

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W +
    'px;height:auto;background:#eff6ff;border:1px solid #cbd5e1;border-radius:6px" ' +
    'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="台風の進路と航路の概略図">' +
    '<polyline points="' + routeLine + '" fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-opacity="0.6"/>' +
    past + forecastLine + routeDots + forecasts + current +
    '<text x="12" y="' + (H - 12) + '" font-size="11" fill="#64748b">' +
    '青線: 航路　灰破線: これまでの経路　橙: 予報　（出典: 気象庁）</text>' +
    '</svg>';
}
