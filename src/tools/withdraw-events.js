// 読み取りの誤りで作ってしまった、存在しない便の記事を取り消す。
//
// 記事を削除し、台帳に取り消しの行を足す。台帳を読むときに取り消した便は
// 外されるため、運航状況のページや台風のページからも消える。
// 台帳の行そのものは消さない（何を載せて何を取り消したかを残すため）。
//
//   node src/tools/withdraw-events.js <event_key> ...          対象を見るだけ
//   node src/tools/withdraw-events.js <event_key> ... --apply  実際に取り消す
//   node src/tools/withdraw-events.js <event_key> ... --draft  削除せず下書きに戻す
//
// 削除は元に戻せない。必ず先に --apply なしで対象を確かめること。
// 迷うときは --draft を使う。読者から見えなくなる点は同じで、やり直せる。

import { loadEnvLocal } from '../lib/env.js';
loadEnvLocal();

import { readEvents, latestEventsByKey, appendEvent } from '../lib/state.js';
import { buildTitle } from '../writer.js';
import { BloggerPublisher, readCredentials } from '../publisher.js';

const APPLY = process.argv.includes('--apply');
const DRAFT = process.argv.includes('--draft');
const reasonArg = process.argv.find((a) => a.startsWith('--reason='));
const reason = reasonArg ? reasonArg.slice('--reason='.length) : '読み取りの誤りで作った存在しない便';
const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!keys.length) {
  console.log('使い方: node src/tools/withdraw-events.js <event_key> ... [--apply]');
  process.exit(1);
}

const ledger = latestEventsByKey(readEvents());
const targets = [];
for (const k of keys) {
  const e = ledger.get(k);
  if (!e) {
    console.log('台帳に無い（取り消し済みか、鍵の誤り）: ' + k);
    process.exit(1);
  }
  targets.push(e);
}

console.log((DRAFT ? '下書きに戻す記事 ' : '削除する記事 ') + targets.length + '件' +
  (APPLY ? '' : '（確認のみ）'));
for (const e of targets) {
  console.log('  ' + buildTitle(e));
  console.log('    ' + (e.published_post?.url ?? '(記事なし)'));
  console.log('    根拠行: ' + (e.evidence ?? '-'));
}

if (!APPLY) process.exit(0);

const publisher = new BloggerPublisher({ credentials: readCredentials(), dryRun: false });
const now = new Date().toISOString();

for (const e of targets) {
  const postId = e.published_post?.id;
  try {
    if (postId) {
      if (DRAFT) await publisher.revertToDraft(postId);
      else await publisher.deletePost(postId);
    }
  } catch (err) {
    // すでに消えている記事は取り消し済みとして扱う。それ以外は台帳に触れない。
    if (!/404|not found/i.test(err.message)) {
      console.log('  失敗  ' + buildTitle(e) + ' — ' + err.message);
      continue;
    }
  }
  appendEvent({
    ...e,
    withdrawn: true,
    withdrawn_at: now,
    withdrawn_reason: reason,
    // 削除したのか下書きに戻しただけなのかを、後から見分けられるようにする
    ...(DRAFT ? { drafted_post: e.published_post ?? null } : { deleted_post: e.published_post ?? null }),
    published_post: null,
  });
  console.log((DRAFT ? '  下書きに戻しました  ' : '  取り消しました  ') + buildTitle(e));
  await new Promise((r) => setTimeout(r, 400));
}
