// .env.local から認証情報を読み込む。
//
// このファイルはGitに含めない（.gitignore で除外）。
// GitHub Actions では Secrets から環境変数が渡るため、このファイルは使われない。
// 手元で動作確認するときだけ使う。

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

const ENV_PATH = join(ROOT, '.env.local');

export function loadEnvLocal() {
  if (!existsSync(ENV_PATH)) return false;

  const text = readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 前後の引用符を外す
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 既に環境変数で指定されているものは上書きしない
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

/** .env.local の1項目を書き換える（無ければ追記する） */
export function setEnvLocal(key, value) {
  const line = `${key}=${value}`;
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text)
    ? text.replace(re, line)
    : (text.endsWith('\n') || text === '' ? text : text + '\n') + line + '\n';
  writeFileSync(ENV_PATH, text, 'utf8');
  return ENV_PATH;
}

export { ENV_PATH };
