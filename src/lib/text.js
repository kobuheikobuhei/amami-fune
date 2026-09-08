// 本文とタイトルから事実を取り出すための共通処理

/** HTMLをプレーンテキストへ。改行は保持する */
export function htmlToText(html) {
  if (!html) return '';
  const stripped = String(html)
    .replace(new RegExp('<script[^]*?</script>', 'gi'), ' ')
    .replace(new RegExp('<style[^]*?</style>', 'gi'), ' ');

  return stripped
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ZEN_DIGITS = '０１２３４５６７８９';
export function normalizeDigits(s) {
  return String(s).replace(/[０-９]/g, (c) => String(ZEN_DIGITS.indexOf(c)));
}

/**
 * 電話番号を除去する。
 * 仕様の追加確定事項により、電話番号は保存も掲載もしない。
 * 公式本文には問い合わせ先が含まれるため、収集の時点で落とす。
 */
export function stripPhoneNumbers(text) {
  return String(text)
    .replace(/0\d{1,4}[-(]\d{1,4}[-)]\d{3,4}/g, '')
    .replace(/0\d{9,10}/g, '');
}

/** 問い合わせ先ブロック以降を落とす */
export function cutContactBlock(text) {
  const lines = String(text).split('\n');
  const idx = lines.findIndex((l) => /お問\s*い?\s*合わせ|お問合せ|問い合わせ先/.test(l));
  return (idx >= 0 ? lines.slice(0, idx) : lines).join('\n').trim();
}

/**
 * テキスト中の日付を、出現位置つきで拾う。
 * 「9月4日」と「9/4」の両方に対応する。
 * 年は基準日（記事の公開日）から推定し、年をまたぐ場合を補正する。
 */
function findDates(text, baseDate) {
  const src = normalizeDigits(text);
  const base = new Date(baseDate);
  const baseYear = base.getUTCFullYear();
  const baseMonth = base.getUTCMonth() + 1;

  const toIso = (yStr, moStr, dStr) => {
    const mo = Number(moStr);
    const d = Number(dStr);
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
    let year = yStr ? Number(yStr) : baseYear;
    if (!yStr) {
      const diff = mo - baseMonth;
      if (diff <= -6) year = baseYear + 1;
      else if (diff >= 6) year = baseYear - 1;
    }
    return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const hits = [];
  const patterns = [
    /(?:(\d{4})年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    /(?<![\d:])(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?![\d:])/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const iso = toIso(m[1], m[2], m[3]);
      if (iso) hits.push({ iso, start: m.index, end: m.index + m[0].length });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  // 同じ箇所を二つの書式で二重に拾った場合を除く
  return hits.filter((h, i) => i === 0 || h.start >= hits[i - 1].end);
}

/** テキスト中の日付を重複なく並べて返す */
export function extractServiceDates(text, baseDate) {
  return [...new Set(findDates(text, baseDate).map((h) => h.iso))].sort();
}

// 日付と日付の間にある「～」「から」などを期間の区切りとみなす。
// 「2026年9月3日(木)～9月14日(月)の間、ドックいたします」を
// 2つの独立した日ではなく1つの期間として扱うために必要。
const RANGE_SEPARATOR = /^[\s\u3000]*(?:[（(][^）)]{0,4}[）)])?[\s\u3000]*(?:[～〜~\-–—]|から|より)[\s\u3000]*$/;

/**
 * テキストを「期間」と「単独の日付」に分けて返す。
 * 期間は { from, to }、単独は { from } のみを持つ。
 */
export function extractDateUnits(text, baseDate) {
  const src = normalizeDigits(text);
  const hits = findDates(text, baseDate);
  const units = [];

  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const next = hits[i + 1];
    if (next) {
      const between = src.slice(cur.end, next.start);
      if (RANGE_SEPARATOR.test(between) && cur.iso <= next.iso) {
        units.push({ from: cur.iso, to: next.iso });
        i++; // 次の日付は期間の終わりとして消費した
        continue;
      }
    }
    units.push({ from: cur.iso });
  }

  return units;
}

/** 期間を日付の配列に展開する。暴走を防ぐため上限を設ける */
export function expandRange(from, to, maxDays = 60) {
  if (!to || to === from) return [from];
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < maxDays) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 上り/下りの判定 */
export function extractDirection(text) {
  if (/下り/.test(text)) return 'down';
  if (/上り/.test(text)) return 'up';
  return null;
}

/** 短い安定ハッシュ。差分検出とevent_id生成に使う */
export function shortHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// 出発港の抽出。長い名前から順に照合し、行内で最も早く現れたものを採る。
// 「9月6日(日) 名瀬港 03:50発 鹿児島新港行き」→ 名瀬（出発港）
const PORTS = [
  '鹿児島本港北埠頭', '鹿児島新港', '鹿児島', '名瀬', '古仁屋', '喜界',
  '亀徳', '和泊', '与論', '本部', '那覇', '平土野', '知名', '徳之島', '沖永良部',
  '生間', '瀬相', '請阿室', '池地', '与路', '谷山',
].sort((a, b) => b.length - a.length);

export function extractOrigin(text) {
  let best = null;
  let bestIdx = Infinity;
  for (const p of PORTS) {
    const i = text.indexOf(p);
    if (i >= 0 && i < bestIdx) {
      bestIdx = i;
      best = p;
    }
  }
  return best;
}

/**
 * テキスト中に現れる港名を、出現順に重複なく全て返す。
 * strict のとき、直後に「港」が続くものだけを採る。
 * 「亀徳港(徳之島)」のような表記で、島名まで港として拾わないようにするため。
 */
export function extractPorts(text, { strict = false } = {}) {
  const hits = [];
  for (const p of PORTS) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(p, from);
      if (i < 0) break;
      hits.push({ port: p, start: i, end: i + p.length });
      from = i + p.length;
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  // 長い港名の一部が短い港名として二重に拾われるのを防ぐ
  const kept = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start < lastEnd) continue;
    if (strict && text.slice(h.end, h.end + 1) !== '港') continue;
    kept.push(h.port);
    lastEnd = h.end;
  }
  return [...new Set(kept)];
}

/**
 * 「◯◯港・△△港へは寄港いたしません」のような、寄港地に関する注記を拾う。
 * 臨時便が一部の島を飛ばすことがあり、利用者にとって欠かせない情報になる。
 */
export function extractPortNotes(text) {
  const notes = [];
  for (const line of String(text).split(String.fromCharCode(10))) {
    if (!/寄港|抜港/.test(line)) continue;
    // 港名として明示されているものだけを採る。
    // 「亀徳港(徳之島)」の島名を港と誤認しないため。
    const ports = extractPorts(line, { strict: true });
    if (!ports.length) continue;

    if (/条件付/.test(line)) {
      notes.push({ kind: "conditional", ports });
    } else if (/寄港(いた)?し(ま(せん|せんので)|ない)/.test(line)) {
      notes.push({ kind: "no_call", ports });
    } else if (/変更/.test(line)) {
      notes.push({ kind: "changed", ports });
    }
  }
  return notes;
}


/**
 * 日本時間での日付（YYYY-MM-DD）。
 * 運航日はすべて日本時間で発表されるため、世界標準時で判定すると
 * 日本の朝0時から9時の間だけ前日として扱われてしまう。
 * 欠航の発表が最も集中する早朝に日付がずれるため、ここを揃える。
 */
export function jstDate(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}