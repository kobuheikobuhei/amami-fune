// 状態ファイルの読み書き。
// state/ 配下はGitHub Actionsの実行間で引き継ぐ必要があるため、リポジトリにコミットする。

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from './config.js';

const STATE_DIR = join(ROOT, 'state');
const SNAPSHOT_DIR = join(STATE_DIR, 'snapshots');
const EVENTS_PATH = join(STATE_DIR, 'events.jsonl');
const MODE_PATH = join(STATE_DIR, 'mode.json');
const HEALTH_PATH = join(STATE_DIR, 'health.json');

function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── スナップショット ────────────────────────────────
// 初回実行かどうかの判定にも使う。スナップショットが無い＝初回。

export function snapshotPath(sourceId) {
  return join(SNAPSHOT_DIR, `${sourceId}.json`);
}

export function readSnapshot(sourceId) {
  return readJson(snapshotPath(sourceId), null);
}

export function writeSnapshot(sourceId, data) {
  writeJson(snapshotPath(sourceId), data);
}

// ── イベント台帳 ──────────────────────────────────

export function readEvents() {
  if (!existsSync(EVENTS_PATH)) return [];
  return readFileSync(EVENTS_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 同じ event_key の行が複数あれば、最後の行を最新とみなす */
export function latestEventsByKey(events) {
  const map = new Map();
  for (const e of events) map.set(e.event_key, e);
  return map;
}

export function appendEvent(event) {
  ensureDir(EVENTS_PATH);
  appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n', 'utf8');
}

// ── モード（平常 / 荒天）──────────────────────────

export function readMode() {
  return readJson(MODE_PATH, { mode: 'normal', since: null, last_run: null, reason: null });
}

export function writeMode(mode) {
  writeJson(MODE_PATH, mode);
}

// ── 取得の健全性 ──────────────────────────────────
// 連続失敗回数を持ち、仕様Q35の「取得失敗中」表示と通知の判定に使う。

export function readHealth() {
  return readJson(HEALTH_PATH, {});
}

export function writeHealth(h) {
  writeJson(HEALTH_PATH, h);
}

export function recordSuccess(health, sourceId, fetchedAt) {
  health[sourceId] = { ok: true, consecutive_failures: 0, last_success: fetchedAt, last_error: null };
  return health;
}

export function recordFailure(health, sourceId, message, at) {
  const prev = health[sourceId] ?? { consecutive_failures: 0, last_success: null };
  health[sourceId] = {
    ok: false,
    consecutive_failures: (prev.consecutive_failures ?? 0) + 1,
    last_success: prev.last_success ?? null,
    last_error: { message, at },
  };
  return health;
}

// ── 常設ページのID記憶 ──────────────────────────
// Bloggerのページは作成時に採番される。次回以降は更新するためIDを覚えておく。

const PAGES_PATH = join(STATE_DIR, 'pages.json');

export function readPageIds() {
  return readJson(PAGES_PATH, {});
}

export function writePageIds(m) {
  writeJson(PAGES_PATH, m);
}

// ── 通知 ────────────────────────────────────────
// 仕様Q29によりメールで通知する。実際の送信はワークフロー側で行うため、
// ここでは本文をファイルに書き出すだけにする。

const NOTIFY_PATH = join(STATE_DIR, 'notify.md');
const DIAGNOSTICS_PATH = join(STATE_DIR, 'diagnostics.json');

/**
 * 実行環境の状態を記録する。
 * 実行ログを開かなくても、リポジトリを見れば何が起きたか分かるようにするため。
 * 認証情報は値を持たず、長さだけを記録する。
 */
export function writeDiagnostics(data) {
  writeJson(DIAGNOSTICS_PATH, data);
}

export function writeNotification(lines) {
  ensureDir(NOTIFY_PATH);
  // 通知が無いときは完全な空ファイルにする。
  // 改行だけでも「中身がある」と判定され、空のメールが送られてしまうため。
  const body = lines.length ? lines.join(String.fromCharCode(10)) + String.fromCharCode(10) : '';
  writeFileSync(NOTIFY_PATH, body, 'utf8');
}
