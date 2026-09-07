// 気象庁の台風情報を取得する。
//
// 出典: 気象庁ホームページ（https://www.jma.go.jp/）
// 気象庁のデータは出典を明示すれば利用できる。
//
// 発生している台風・熱帯低気圧の一覧を取ってから、それぞれの詳細を取得する。
// 熱帯低気圧の段階では強さ・大きさ・最大風速が空欄になるため、
// 値がある項目だけを扱う作りにしている。

import { fetchText } from '../lib/fetcher.js';

const BASE = 'https://www.jma.go.jp/bosai/typhoon/data';

// 名瀬港のおおよその位置。航路目線で距離を示すための基準点。
export const NAZE = { lat: 28.377, lon: 129.487, name: '名瀬港' };

const COMPASS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
                 '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

/** 2点間の距離（km）。地球を球とみなす */
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** aから見たbの方位（16方位） */
export function bearingLabel(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 22.5) % 16];
}

function pickPart(parts, jpName) {
  return parts.find((p) => (typeof p.part === 'string' ? p.part : p.part?.jp) === jpName);
}

/** 「-」や空文字を除いた値を返す */
function value(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
}

async function fetchJson(url, userAgent) {
  const { body } = await fetchText(url, { userAgent });
  return JSON.parse(body);
}

export async function watchTyphoon({ userAgent }) {
  const list = await fetchJson(`${BASE}/targetTc.json`, userAgent);
  const fetchedAt = new Date().toISOString();

  const typhoons = [];
  for (const tc of list ?? []) {
    const id = tc.tropicalCyclone;
    if (!id) continue;

    let spec;
    try {
      spec = await fetchJson(`${BASE}/${id}/specifications.json`, userAgent);
    } catch {
      continue; // 個別の取得に失敗しても、他の台風の情報は出す
    }

    const title = pickPart(spec, 'title') ?? spec.find((p) => p.part === 'title') ?? {};
    const now = pickPart(spec, '実況');
    if (!now) continue;

    const deg = now.position?.deg;
    const center = Array.isArray(deg) ? { lat: deg[0], lon: deg[1] } : null;

    // 予報は台風に発達してから出る。無い場合もある。
    let forecasts = [];
    let track = [];
    try {
      const fc = await fetchJson(`${BASE}/${id}/forecast.json`, userAgent);
      // 実況の part にこれまでの経路が入っている。進路図を描くのに使う。
      const analysis = (fc ?? []).find((p) => (typeof p.part === 'string' ? p.part : p.part?.jp) === '実況');
      const tk = analysis?.track ?? {};
      track = [...(tk.preTyphoon ?? []), ...(tk.typhoon ?? [])];
      forecasts = (fc ?? [])
        .filter((p) => p.advancedHours > 0)
        .map((p) => {
          const c = p.forecastCircle?.basePoint ?? p.center;
          const pos = Array.isArray(c) ? { lat: c[0], lon: c[1] } : null;
          return {
            hours: p.advancedHours,
            validtime: p.validtime?.JST ?? null,
            category: value(p.category?.jp),
            intensity: value(p.intensity),
            scale: value(p.scale),
            pressure: value(p.pressure),
            position: pos,
            distanceKm: pos ? Math.round(distanceKm(NAZE, pos)) : null,
            bearing: pos ? bearingLabel(NAZE, pos) : null,
          };
        });
    } catch {
      forecasts = [];
      track = [];
    }

    typhoons.push({
      id,
      number: value(title.typhoonNumber) ?? value(tc.typhoonNumber),
      name: value(title.name?.jp),
      nameEn: value(title.name?.en),
      category: value(now.category?.jp) ?? value(tc.category),
      scale: value(now.scale),
      intensity: value(now.intensity),
      pressure: value(now.pressure),
      maxWind: value(now.maximumWind?.sustained?.range?.[0] ?? now.maximumWind?.sustained ?? now.maximumWind),
      gustWind: value(now.maximumWind?.gust?.range?.[0] ?? now.gustWind),
      course: value(now.course),
      speed: value(now.speed?.note?.jp ?? (now.speed?.km ? `${now.speed.km}km/h` : null)),
      location: value(now.location),
      position: center,
      distanceKm: center ? Math.round(distanceKm(NAZE, center)) : null,
      bearing: center ? bearingLabel(NAZE, center) : null,
      issuedAt: title.issue?.JST ?? null,
      validAt: now.validtime?.JST ?? null,
      forecasts,
      track,
    });
  }

  return { fetchedAt, typhoons };
}
