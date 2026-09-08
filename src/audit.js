// 日次の点検（仕様 §2.1 の auditor）。
//
// 公式の発表・台帳・実際のブログの3つを突き合わせ、食い違いを探す。
// 収集が動いていても、分類や対応づけが壊れていれば情報は静かに欠落する。
// 静かに欠落することが最も危険なので、毎日照合して見つけ次第知らせる。
//
// 検出する項目は、実際に起きた不具合から決めている。
//   ・分類できない発表（解析の失敗）
//   ・日付が取れず継続中でもない発表（解析の失敗）
//   ・台帳にあるのに記事が無い（投稿の失敗が放置される）
//   ・同じ記事が二重に投稿されている
//   ・ブログにあるのに台帳に無い（手で作った記事の混入、台帳の破損）
//   ・継続中の案内が長く続きすぎている（古い情報の放置）
//   ・状態と表示の語が食い違う

import { loadEnvLocal } from './lib/env.js';
loadEnvLocal();

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, activeRouteIds, ROOT } from './lib/config.js';
import { watchAline } from './watchers/aline.js';
import { watchMarix } from './watchers/marix.js';
import { toCandidates, ongoingNotices } from './curator.js';
import { buildPermalink } from './writer.js';
import { classify, NOT_ARTICLE, STATUS_LABEL } from './lib/status.js';
import { jstDate } from './lib/text.js';
import { readEvents, latestEventsByKey, readHealth } from './lib/state.js';
import { readCredentials, getAccessToken } from './publisher.js';

const PHASE = Number(process.env.PHASE ?? 1);
const STALE_NOTICE_DAYS = 90;

const WATCHERS = {
  'aline-kagoshima-rss': watchAline,
  'aline-amami-rss': watchAline,
  'marix-service-rss': watchMarix,
};

function daysSince(iso, now) {
  if (!iso) return null;
  return Math.floor((new Date(now) - new Date(iso)) / 86400000);
}

async function fetchPosts(credentials) {
  const token = await getAccessToken(credentials);
  const res = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${credentials.blogId}/posts?fetchBodies=false&maxResults=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return (json.items ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    url: p.url,
    slug: p.url.split('/').pop().replace('.html', ''),
    base: p.url.split('/').pop().replace('.html', '').replace(/_\d+$/, ''),
  }));
}

export async function runAudit({ now = new Date().toISOString() } = {}) {
  const cfg = loadConfig();
  const today = jstDate(now);
  const routeIds = activeRouteIds(cfg.routes, PHASE);
  const findings = [];
  const add = (level, kind, message, detail) => findings.push({ level, kind, message, detail });

  // ── 公式の発表を集める ──
  const sources = cfg.sources.filter(
    (s) => s.role === 'primary' && WATCHERS[s.id] && s.route_ids?.some((id) => routeIds.has(id))
  );
  const observations = [];
  for (const source of sources) {
    try {
      const r = await WATCHERS[source.id](source, { userAgent: cfg.userAgent });
      observations.push(...r.observations);
    } catch (err) {
      add('重大', '取得', `${source.id} から取得できません`, err.message);
    }
  }

  // ── 収集の健全性 ──
  const health = readHealth();
  for (const [id, h] of Object.entries(health)) {
    if (!h.ok && h.consecutive_failures >= 2) {
      add('重大', '取得', `${id} が連続${h.consecutive_failures}回失敗しています`,
        `最後に成功したのは ${h.last_success ?? '記録なし'}`);
    }
  }

  // ── 解析の失敗を探す ──
  const notices = ongoingNotices(observations, { now });
  const noticeUrls = new Set(notices.map((n) => n.source_url));

  for (const obs of observations) {
    if (!obs.status) {
      add('要確認', '分類', '状態を判定できない発表があります', `${obs.title} / ${obs.link}`);
      continue;
    }
    if (NOT_ARTICLE.has(obs.status)) continue;

    if ((obs.entries ?? []).length === 0 && !noticeUrls.has(obs.link)) {
      add('要確認', '抽出', '日付を取り出せず、継続中でもない発表があります',
        `${obs.title} / ${obs.link}`);
    }

    // 状態と表示の語が食い違っていないか
    if (obs.detail && classify(obs.detail) && classify(obs.detail) !== obs.status) {
      add('要確認', '矛盾', '状態と表示の語が食い違っています',
        `${obs.title}: 状態=${STATUS_LABEL[obs.status]} 表示=${obs.detail}`);
    }
  }

  // ── 継続中の案内が古すぎないか ──
  for (const n of notices) {
    const days = daysSince(n.since ?? n.published_at, now);
    if (days !== null && days > STALE_NOTICE_DAYS) {
      add('要確認', '陳腐化', `継続中の案内が${days}日続いています`,
        `${n.ship ?? ''} ${n.title} — まだ有効か公式で確認してください`);
    }
  }

  return { now, today, cfg, observations, notices, findings, add, routeIds };
}

/** 台帳・記事・公式の突き合わせまで行い、報告文を返す */
export async function runFullAudit({ now = new Date().toISOString() } = {}) {
  const ctx = await runAudit({ now });
  const { today, observations, findings, add } = ctx;

  const candidates = toCandidates(observations, { now });
  const ledger = latestEventsByKey(readEvents());

  // ── 公式に出ているのに台帳に無いもの ──
  for (const c of candidates) {
    if (!ledger.has(c.event_key)) {
      add('重大', '欠落', '公式に出ているのに台帳にありません',
        `${c.service_date} ${STATUS_LABEL[c.status]} ${c.ship ?? c.operator_id} / ${c.source_url}`);
    }
  }

  // ── 台帳にあるのに記事が無いもの ──
  for (const e of ledger.values()) {
    const last = e.service_date_end ?? e.service_date;
    if (last < today) continue; // 終わった便は対象外
    if (!e.published_post?.id) {
      add('重大', '未投稿', '台帳にあるのに記事が作られていません',
        `${e.service_date} ${STATUS_LABEL[e.status]} ${e.ship ?? e.operator_id}`);
    }
  }

  // ── 実際のブログと突き合わせる ──
  let posts = [];
  try {
    posts = await fetchPosts(readCredentials());
  } catch (err) {
    add('重大', '接続', 'ブログの記事一覧を取得できません', err.message);
  }

  if (posts.length) {
    // 同じ記事が二重に投稿されていないか
    const byBase = new Map();
    for (const p of posts) {
      if (!byBase.has(p.base)) byBase.set(p.base, []);
      byBase.get(p.base).push(p);
    }
    for (const [base, list] of byBase) {
      if (list.length > 1) {
        add('重大', '重複', '同じ内容の記事が複数あります',
          `${base}（${list.length}件）: ${list.map((x) => x.slug).join(' / ')}`);
      }
    }

    // 台帳が指す記事が実在するか
    const byId = new Map(posts.map((p) => [p.id, p]));
    const referenced = new Set();
    for (const e of ledger.values()) {
      const id = e.published_post?.id;
      if (!id) continue;
      referenced.add(id);
      if (!byId.has(id)) {
        add('重大', '消失', '台帳が指す記事がブログに存在しません',
          `${e.service_date} ${STATUS_LABEL[e.status]} / 記事ID ${id}`);
      }
    }

    // ブログにあるのに台帳が知らない記事
    for (const p of posts) {
      if (!referenced.has(p.id)) {
        add('要確認', '孤立', '台帳に無い記事がブログにあります',
          `${p.title} / ${p.url}`);
      }
    }
  }

  return { ...ctx, candidates, ledger, posts, findings };
}

/** 報告文を組み立てる */
export function formatReport({ now, today, findings, candidates, notices, posts, ledger }) {
  const jst = new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const serious = findings.filter((f) => f.level === '重大');
  const check = findings.filter((f) => f.level === '要確認');

  const lines = [];
  lines.push(`# 船舶動静ボット 定期点検 (${jst})`);
  lines.push('');
  lines.push(`- 公式の発表: ${candidates?.length ?? 0}件の便を検出`);
  lines.push(`- 継続中のお知らせ: ${notices?.length ?? 0}件`);
  lines.push(`- 台帳: ${ledger?.size ?? 0}件`);
  lines.push(`- ブログの記事: ${posts?.length ?? 0}件`);
  lines.push('');

  if (!findings.length) {
    lines.push('食い違いは見つかりませんでした。');
    return { text: lines.join('\n'), hasFindings: false, serious: 0 };
  }

  for (const [label, list] of [['重大', serious], ['要確認', check]]) {
    if (!list.length) continue;
    lines.push(`## ${label}（${list.length}件）`);
    lines.push('');
    for (const f of list) {
      lines.push(`- **[${f.kind}]** ${f.message}`);
      if (f.detail) lines.push(`  ${f.detail}`);
    }
    lines.push('');
  }

  return { text: lines.join('\n'), hasFindings: true, serious: serious.length };
}

// 直接実行されたときは点検して報告を書き出す
if (process.argv[1] && process.argv[1].endsWith('audit.js')) {
  const result = await runFullAudit();
  const report = formatReport(result);
  console.log(report.text);
  mkdirSync(join(ROOT, 'state'), { recursive: true });
  writeFileSync(join(ROOT, 'state', 'audit.md'), report.hasFindings ? report.text + '\n' : '', 'utf8');
  if (report.serious) console.log(`\n重大な項目が ${report.serious} 件あります。`);
}
