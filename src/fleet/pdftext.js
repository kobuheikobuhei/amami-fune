// PDFから文字を座標つきで取り出す。
//
// 文字だけを順に並べると、表の空欄が失われて列がずれる。
// 実際、マルエーフェリーの配船表は30日分の表なのに記号が23個しか
// 並ばず、どの記号がどの日か対応づけられなかった。
//
// 座標を保ったまま取り出し、同じ高さのものを行、近い横位置のものを
// 列として組み立てる。

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** ページごとに、文字とその位置を返す */
export async function extractItems(data) {
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => (it.str ?? '').trim())
      .map((it) => ({
        text: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
        width: it.width ?? 0,
      }));
    pages.push({ page: n, items });
  }

  if (typeof doc.destroy === "function") await doc.destroy();
  return pages;
}

/** 同じ高さのものを1行にまとめる。文字の大きさの揺れを吸収する */
export function toRows(items, tolerance = 3) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];

  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
    if (row) {
      row.items.push(it);
      row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }

  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * 見出しの横位置を基準に、行の中身を列へ割り当てる。
 * 空欄はそのまま空欄として残るため、日付との対応が崩れない。
 */
export function alignToColumns(rowItems, columnXs, tolerance = 8) {
  const out = new Array(columnXs.length).fill(null);

  for (const it of rowItems) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < columnXs.length; i++) {
      const d = Math.abs(columnXs[i] - it.x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0 && bestDist <= tolerance) {
      out[best] = out[best] ? out[best] + it.text : it.text;
    }
  }
  return out;
}
