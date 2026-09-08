// 仕様 §2.3 の状態定義。ここに無い状態は作らない。

export const STATUS = {
  NORMAL: 'normal',
  CANCELLED: 'cancelled',
  CONDITIONAL: 'conditional',
  EXTRA: 'extra',
  RESUMED: 'resumed',
  UNDECIDED: 'undecided',
  UNKNOWN: 'unknown',
};

export const STATUS_LABEL = {
  normal: '平常運航',
  cancelled: '欠航',
  conditional: '条件付き運航',
  extra: 'ダイヤ変更',
  resumed: '運航再開',
  undecided: '運航可否未定',
  unknown: '取得失敗',
};

export const STATUS_COLOR = {
  normal: '#6b7280',
  cancelled: '#dc2626',
  conditional: '#d97706',
  extra: '#2563eb',
  resumed: '#16a34a',
  undecided: '#d97706',
  unknown: '#dc2626',
};

/** 自動公開してよい状態（仕様Q28） */
// 自動公開してよい状態（仕様Q28）。
// 条件付き運航は「こちらの推測」ではなく「会社の公式発表」であり、
// どの港が条件付きかまで明示されている確定情報のため自動公開する。
// 運航可否未定は、発表そのものに中身が乏しく短時間で覆るため下書きに留める。
export const AUTO_PUBLISHABLE = new Set([
  STATUS.CANCELLED,
  STATUS.EXTRA,
  STATUS.RESUMED,
  STATUS.CONDITIONAL,
]);

/** 記事にしない状態 */
export const NOT_ARTICLE = new Set([STATUS.NORMAL, STATUS.UNKNOWN]);

// 判定の順序に意味がある。先に来たものが優先される。
// 「条件付運航」は「運航」を含むため平常運航より先に、
// 「運航再開」は「運休解除・運航再開」のような表現のため運休より先に置く。
const RULES = [
  { re: /欠航/, status: STATUS.CANCELLED },
  { re: /条件付/, status: STATUS.CONDITIONAL },
  { re: /未定|検討中/, status: STATUS.UNDECIDED },
  { re: /運航再開|運行再開/, status: STATUS.RESUMED },
  { re: /臨時便|臨時運航/, status: STATUS.EXTRA },
  { re: /ドック|入渠/, status: STATUS.EXTRA },
  { re: /運休/, status: STATUS.EXTRA },
  { re: /スケジュール変更|航行経路変更|経路変更|寄港地変更|時刻変更|ダイヤ変更/, status: STATUS.EXTRA },
  { re: /通常運航|平常運航/, status: STATUS.NORMAL },
];

/**
 * テキストから状態を判定する。
 * 判定できない場合は null を返し、呼び出し側で「要判断」として下書きに回す。
 */
export function classify(text) {
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.status;
  }
  return null;
}

// 読者に見せる具体的な語。状態だけでは「ドック運休」と「臨時便」の区別がつかないため、
// 元の表現から拾う。テキスト中に最初に現れた語を採用する。
const DETAIL_WORDS = [
  'ドック', '入渠', '機関故障', '運休', '臨時便', '欠航',
  '条件付運航', '条件付き運航', '航行経路変更', '経路変更', 'スケジュール変更',
  '寄港地変更', '時刻変更', '運航再開', '通常運航', '平常運航',
];

export function detailLabel(text, status = null) {
  if (!text) return null;
  let best = null;
  let bestIdx = Infinity;
  for (const w of DETAIL_WORDS) {
    // 判定された状態と矛盾する語は使わない。
    // 「ドック後、9月15日より運航再開予定」という行から
    // 運航再開の便に「ドック」という語を付けてしまうのを防ぐ。
    if (status && classify(w) !== status) continue;
    const i = text.indexOf(w);
    if (i >= 0 && i < bestIdx) {
      bestIdx = i;
      best = w;
    }
  }
  return best;
}


/**
 * 表示に使う言い回しを、本文に実際に書かれている語から組み立てる。
 *
 * 「ドック入り」と「運休」は別のことを指す。船がドックに入っても、
 * 別の船が入れば便は動く。公式が運休と言っていないのに運休と書けば、
 * 船が来ないという誤解を与える。
 *
 * 実際、マルエーフェリーのドック案内は船の入渠を告げるだけで
 * 便の運休には触れていない。一方、共同組海運のドック案内は
 * 「運休となります」と明記している。両者を同じ言葉で表してはいけない。
 */
export function detailPhrase(text, status) {
  if (!text) return null;
  const has = (w) => text.includes(w);

  const dock = has('ドック') || has('入渠');
  const suspended = has('運休');
  const failure = has('機関故障');

  if (dock && suspended) return 'ドック入りのため運休';
  if (dock) return 'ドック入り';
  if (failure && suspended) return '機関故障のため運休';
  if (suspended) return '運休';

  return detailLabel(text, status);
}