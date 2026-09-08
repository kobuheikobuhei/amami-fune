// エントリポイント。GitHub Actions から30分ごとに呼ばれる。
//
// 平常モードでは1時間に1回だけ実際の収集を行い、荒天モードでは毎回行う（仕様 §2.2）。
// --dry-run を付けると取得と判定だけを行い、投稿も状態の書き込みもしない。
// --force を付けると平常モードの間引きを無視して実行する。

import { loadEnvLocal } from './lib/env.js';
import { loadConfig, activeRouteIds } from './lib/config.js';

loadEnvLocal();
import { watchAline } from './watchers/aline.js';
import { watchMarix } from './watchers/marix.js';
import { watchKyodogumi } from './watchers/kyodogumi.js';
import { watchWeather, decideMode, shouldRun } from './watchers/weather.js';
import {
  readSnapshot, writeSnapshot, readEvents, latestEventsByKey, appendEvent,
  readHealth, writeHealth, recordSuccess, recordFailure,
  readMode, writeMode, readPageIds, writePageIds, writeNotification, writeDiagnostics,
} from './lib/state.js';
import { toCandidates, diffAgainstLedger, publishDecision, ongoingNotices, normalShips } from './curator.js';
import { buildArticle } from './writer.js';
import { buildStatusPage } from './statuspage.js';
import { watchTyphoon } from './watchers/typhoon.js';
import { buildTyphoonPage } from './typhoonpage.js';
import { buildDailyPage } from './dailypage.js';
import { buildNav, buildArticleNav } from './nav.js';
import { buildTyphoonAlert } from './alert.js';
import { buildScopeNotice } from './scope.js';
import { BloggerPublisher, readCredentials } from './publisher.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const NO_PUBLISH = process.argv.includes('--no-publish'); // 状態は書くが投稿はしない（検証用）
const PHASE = Number(process.env.PHASE ?? 1);
const FAIL_THRESHOLD = 2;

const WATCHERS = {
  'aline-kagoshima-rss': watchAline,
  'aline-amami-rss': watchAline,
  'marix-service-rss': watchMarix,
  'kyodogumi-html': watchKyodogumi,
};

const log = (...a) => console.log(...a);

async function main() {
  const cfg = loadConfig();
  const now = new Date().toISOString();
  const routeIds = activeRouteIds(cfg.routes, PHASE);
  const routeById = Object.fromEntries(cfg.routes.map((r) => [r.id, r]));
  const notify = [];
  if (process.env.TEST_NOTIFY === 'true') {
    notify.push('- これはメール通知の動作確認です。この文面が届いていれば通知は正しく設定されています。');
  }

  // 値そのものは出さず、長さだけを記録する。
  // 手元と実行環境で認証情報が食い違っていないかを突き合わせるため。
  const credentialLengths = Object.fromEntries(
    ['BLOGGER_BLOG_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']
      .map((k) => [k, (process.env[k] ?? '').trim().length])
  );
  log('認証情報の長さ: ' + JSON.stringify(credentialLengths));
  const diagnostics = { at: now, credential_lengths: credentialLengths };
  // メール通知の設定状況。値は持たず、登録の有無と長さだけを見る。
  diagnostics.mail_lengths = Object.fromEntries(
    ['MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_TO']
      .map((k) => [k, (process.env[k] ?? '').trim().length])
  );

  const prevMode = readMode();
  let mode = prevMode;
  const weatherSource = cfg.sources.find((s) => s.id === 'jma-warning-amami');
  let weatherResult = null;
  // 台風はモードの判定にも使うため、収集より先に取得する。
  let typhoonResult = { typhoons: [] };
  try {
    typhoonResult = await watchTyphoon({ userAgent: cfg.userAgent });
  } catch (err) {
    log('台風情報の取得に失敗: ' + err.message);
  }
  try {
    weatherResult = await watchWeather(weatherSource, { userAgent: cfg.userAgent });
    mode = decideMode(prevMode, weatherResult, typhoonResult.typhoons, now);
    log('モード: ' + mode.mode + '（' + mode.reason + '）');
  } catch (err) {
    log('気象情報の取得に失敗: ' + err.message + ' — 前回のモードを維持します');
    notify.push('- 気象情報の取得に失敗: ' + err.message);
  }

  if (!FORCE && !shouldRun(mode.mode, prevMode.last_run, now)) {
    log('平常モードのため今回は収集をスキップします');
    if (!DRY_RUN) writeMode({ ...mode, last_run: prevMode.last_run });
    return;
  }

  const targets = cfg.sources.filter(
    (s) => s.role === 'primary' && WATCHERS[s.id] && s.route_ids?.some((id) => routeIds.has(id))
  );
  log('[' + now + '] フェーズ' + PHASE + ' / 対象ソース ' + targets.length + '件' + (DRY_RUN ? '（ドライラン）' : ''));

  const health = readHealth();
  const observations = [];
  const seedOnlySources = new Set();

  for (const source of targets) {
    const firstRun = readSnapshot(source.id) === null;
    if (firstRun) seedOnlySources.add(source.id);

    try {
      const r = await WATCHERS[source.id](source, { userAgent: cfg.userAgent });
      observations.push(...r.observations);
      recordSuccess(health, source.id, r.fetchedAt);
      log('  ok   ' + source.id + '  記事' + r.observations.length + '件' + (firstRun ? ' [初回：記録のみ]' : ''));

      if (!DRY_RUN) {
        writeSnapshot(source.id, {
          fetched_at: r.fetchedAt,
          items: r.observations.map((o) => ({ guid: o.guid, hash: o.body_hash })),
        });
      }
    } catch (err) {
      recordFailure(health, source.id, err.message, now);
      const n = health[source.id].consecutive_failures;
      log('  FAIL ' + source.id + '  ' + err.message + '（連続' + n + '回）');
      if (n >= FAIL_THRESHOLD) notify.push('- 取得失敗: ' + source.id + ' — ' + err.message + '（連続' + n + '回）');
    }
  }

  const candidates = toCandidates(observations, { now });
  const notices = ongoingNotices(observations, { now });
  // 公式が通常運航と掲げている船。個別の案内がある船は除かれる。
  const normalByRoute = normalShips(observations, { now }).reduce((acc, n) => {
    (acc[n.route_id] ??= []).push(n);
    return acc;
  }, {});
  const ledger = latestEventsByKey(readEvents());
  const actions = diffAgainstLedger(candidates, ledger, { seedOnlySources, now });

  const created = actions.filter((a) => a.type === 'create');
  const updated = actions.filter((a) => a.type === 'update');
  const seeded = actions.filter((a) => a.type === 'seed');
  log('\n候補' + candidates.length + '件 → 新規' + created.length + ' / 続報' + updated.length + ' / 初回記録' + seeded.length);

  // 記事にもメニューと台風の知らせを入れるため、投稿より先に用意する。
  const pageIds = readPageIds();
  // 案内は前回の実行で記録したURLから作る。
  // 初回はまだURLが無いため案内なしで作られ、次の実行から入る。
  const phaseRoutes = [...routeIds].map((id) => routeById[id]).filter(Boolean);
  const articleNav = buildArticleNav(pageIds);
  // 台風の警告。毎回作り直すページにだけ入れる。
  // 記事に入れると、台風が去った後も古い警報が残り続ける。
  const typhoonAlert = buildTyphoonAlert({
    typhoons: typhoonResult.typhoons,
    url: pageIds.__typhoon?.url ?? null,
  });

  // 掲載していない航路を明示する。読者が「発表がない＝平常運航」と
  // 誤解するのが、情報を出さないことより悪い状態になる。
  const scopeNotice = buildScopeNotice({
    routes: cfg.routes,
    routeIds,
    operators: cfg.operators,
  });

  const publisher = new BloggerPublisher({
    credentials: DRY_RUN || NO_PUBLISH ? {} : readCredentials(),
    dryRun: DRY_RUN || NO_PUBLISH,
  });

  for (const a of [...created, ...updated]) {
    const article = buildArticle(a.event, { route: routeById[a.event.route_id], nav: articleNav });
    const decision = publishDecision(a.event);
    const kind = a.type === 'create' ? '新規' : '続報';

    try {
      let result;
      if (a.type === 'update' && a.event.published_post?.id) {
        result = await publisher.update(a.event.published_post.id, article);
      } else if (decision === 'publish') {
        result = await publisher.createPublished(article);
      } else {
        result = await publisher.createDraft(article);
      }

      a.event.published_post = {
        id: result.id,
        url: result.url ?? null,
        is_draft: decision === 'draft',
        permalink_expected: article.permalink,
        at: now,
      };

      log('  [' + kind + '/' + (decision === 'publish' ? '公開' : '下書き') + '] ' + article.title);
      log('      ' + (result.url ?? '(下書き)'));

      if (decision === 'draft') {
        notify.push('- 要確認の下書き: ' + article.title + '\n  ' + a.event.source_url);
      }
    } catch (err) {
      log('  投稿失敗: ' + article.title + ' — ' + err.message);
      notify.push('- 投稿失敗: ' + article.title + ' — ' + err.message);
    }
  }

  const merged = latestEventsByKey([
    ...readEvents(),
    ...[...created, ...updated, ...seeded].map((a) => a.event),
  ]);

  for (const routeId of routeIds) {
    const route = routeById[routeId];
    if (!route) continue;
    const operator = cfg.operators[route.operator_id];
    const routeEvents = [...merged.values()].filter((e) => e.route_id === routeId);
    const routeSources = cfg.sources.filter(
      (s) => s.role === 'primary' && s.route_ids?.includes(routeId)
    );
    const routeHealth = routeSources.map((s) => health[s.id]).filter(Boolean);

    const page = buildStatusPage({
      route, operator,
      events: routeEvents,
      health: routeHealth,
      officialUrl: operator?.site ?? '#',
      referenceLinks: cfg.referenceLinks,
      notices: notices.filter((n) => n.route_id === routeId),
      now,
      nav: buildNav(pageIds, phaseRoutes, routeId),
      alert: typhoonAlert,
      failThreshold: FAIL_THRESHOLD,
    });

    try {
      const r = await publisher.upsertPage(pageIds[routeId]?.id ?? null, page);
      pageIds[routeId] = { id: r.id, url: r.url ?? pageIds[routeId]?.url ?? null };
      log('  常設ページ更新: ' + page.title);
    } catch (err) {
      log('  常設ページの更新に失敗: ' + routeId + ' — ' + err.message);
      notify.push('- 常設ページの更新に失敗: ' + routeId + ' — ' + err.message);
    }
  }

  // 今日・明日の運航状況。全航路を横断した1枚。
  const eventsByRouteAll = {};
  for (const e of merged.values()) {
    (eventsByRouteAll[e.route_id] ??= []).push(e);
  }
  const noticesByRoute = notices.reduce((acc, n) => {
    (acc[n.route_id] ??= []).push(n);
    return acc;
  }, {});

  try {
    const dailyPage = buildDailyPage({
      routes: [...routeIds].map((id) => routeById[id]).filter(Boolean),
      eventsByRoute: eventsByRouteAll,
      noticesByRoute,
      operators: cfg.operators,
      normalByRoute,
      nav: buildNav(pageIds, phaseRoutes, '__daily'),
      scope: scopeNotice,
      alert: typhoonAlert,
      now,
    });
    const r = await publisher.upsertPage(pageIds.__daily?.id ?? null, dailyPage);
    pageIds.__daily = { id: r.id, url: r.url ?? pageIds.__daily?.url ?? null };
    log('  今日・明日のまとめ更新');
  } catch (err) {
    log('  今日・明日のまとめの更新に失敗: ' + err.message);
    notify.push('- 今日・明日のまとめの更新に失敗: ' + err.message);
  }

  // 台風特設ページ。台風が無いときも「発生していない」と示すため常に更新する。
  try {
    const typhoons = typhoonResult.typhoons;
    const eventsByRoute = eventsByRouteAll;
    const typhoonPage = buildTyphoonPage({
      typhoons,
      weather: weatherResult,
      nav: buildNav(pageIds, phaseRoutes, '__typhoon'),
      routes: [...routeIds].map((id) => routeById[id]).filter(Boolean),
      eventsByRoute,
      noticesByRoute,
      now,
    });
    const r = await publisher.upsertPage(pageIds.__typhoon?.id ?? null, typhoonPage);
    pageIds.__typhoon = { id: r.id, url: r.url ?? pageIds.__typhoon?.url ?? null };
    log('  台風ページ更新: 発生中 ' + typhoons.length + '件');
  } catch (err) {
    log('  台風ページの更新に失敗: ' + err.message);
    notify.push('- 台風ページの更新に失敗: ' + err.message);
  }
  if (!DRY_RUN) {
    diagnostics.result = {
      mode: mode.mode,
      sources: targets.length,
      observations: observations.length,
      candidates: candidates.length,
      created: created.length,
      updated: updated.length,
      seeded: seeded.length,
      status_pages: Object.keys(pageIds).length,
      notifications: notify.length,
    };
    writeDiagnostics(diagnostics);
    for (const a of [...created, ...updated, ...seeded]) appendEvent(a.event);
    writeHealth(health);
    writeMode(mode);
    writePageIds(pageIds);
    writeNotification(notify.length ? ['# 船舶動静ボット 通知 (' + now + ')', '', ...notify] : []);
  }

  log(notify.length ? '\n通知 ' + notify.length + '件' : '\n通知なし');
}

main().catch((e) => {
  console.error('致命的エラー:', e);
  process.exit(1);
});
