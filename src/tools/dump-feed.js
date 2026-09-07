// RSSの生構造を確認するための調査用スクリプト
import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../lib/fetcher.js';
import { loadConfig } from '../lib/config.js';

const url = process.argv[2];
const limit = Number(process.argv[3] ?? 3);
const { userAgent } = loadConfig();

const { body } = await fetchText(url, { userAgent });
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
const doc = parser.parse(body);
const items = doc?.rss?.channel?.item ?? [];
const list = Array.isArray(items) ? items : [items];

console.log('=== channel keys:', Object.keys(doc?.rss?.channel ?? {}).join(', '));
console.log('=== item count:', list.length);
for (const it of list.slice(0, limit)) {
  console.log('\n--- item keys:', Object.keys(it).join(', '));
  for (const [k, v] of Object.entries(it)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`  ${k}: ${s.slice(0, 400).replace(/\s+/g, ' ')}`);
  }
}
