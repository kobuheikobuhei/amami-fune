// RSS取得と正規化。
// 注意: dc:creator には配信元によって個人のメールアドレスが入ることがあるため、
// ここで破棄し、以降の処理・保存・掲載のどこにも渡さない。

import { XMLParser } from 'fast-xml-parser';
import { fetchText } from './fetcher.js';

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

/** creatorが個人を特定しうる値（メールアドレス）かどうか */
function isPersonalCreator(v) {
  return typeof v === 'string' && /@/.test(v);
}

export async function fetchFeed(url, { userAgent }) {
  const { body, fetchedAt } = await fetchText(url, { userAgent });
  const doc = parser.parse(body);
  const raw = doc?.rss?.channel?.item ?? [];
  const items = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);

  return {
    fetchedAt,
    items: items.map((it) => {
      const guidNode = it.guid;
      const guid =
        typeof guidNode === 'string' ? guidNode : guidNode?.['#text'] ?? it.link ?? '';
      const creator = it['dc:creator'];
      return {
        title: String(it.title ?? '').trim(),
        link: String(it.link ?? '').trim(),
        guid: String(guid).trim(),
        pubDate: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        contentHtml: String(it['content:encoded'] ?? it.description ?? ''),
        // 個人メールアドレスは保持しない。船名・部署名などの表示名のみ残す
        creator: isPersonalCreator(creator) ? null : creator ? String(creator).trim() : null,
      };
    }),
  };
}
