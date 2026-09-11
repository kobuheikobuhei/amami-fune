// HTTP取得。User-Agentに連絡先を明示し、タイムアウトと再試行を持つ。
// 仕様Q17: 相手先に負荷をかけない。1ソースあたり1回のリクエストに留める。

const DEFAULT_TIMEOUT_MS = 20000;
const RETRY_COUNT = 2;
const RETRY_WAIT_MS = 3000;

export class FetchError extends Error {
  constructor(message, { url, status = null, cause = null } = {}) {
    super(message);
    this.name = 'FetchError';
    this.url = url;
    this.status = status;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 文字コードは相手が決める。Response.text() は中身に関わらずUTF-8として読むため、
// Shift_JIS のページは全文が壊れる。KKB（九州のりものinfo）の携帯向けページが
// これにあたる。Content-Type の charset を見て読み替え、無ければ meta から拾う。
function decodeBody(bytes, contentType) {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  // meta の宣言は先頭にある。壊れても構わない読み方で覗くだけなので latin1 で足りる。
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const fromMeta = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // 知らない名前を送ってくる相手もいる。読めないより化けたまま進むほうがよい。
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * URLを取得して本文テキストを返す。
 * 失敗しても例外を投げず、{ ok:false } を返す設計にはしない。
 * 取得失敗は仕様上「unknown 状態」として扱う必要があり、呼び出し側で明示的に握る。
 */
export async function fetchText(url, { userAgent, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) await sleep(RETRY_WAIT_MS);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/rss+xml, application/xml, text/xml, text/html, application/json;q=0.9, */*;q=0.8',
          'Accept-Language': 'ja,en;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!res.ok) {
        lastError = new FetchError(`HTTP ${res.status}`, { url, status: res.status });
        // 4xx は再試行しても無駄なので即座に諦める
        if (res.status >= 400 && res.status < 500) break;
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const body = decodeBody(bytes, res.headers.get('content-type'));
      return { body, status: res.status, fetchedAt: new Date().toISOString() };
    } catch (err) {
      lastError = new FetchError(err.name === 'AbortError' ? 'タイムアウト' : err.message, {
        url,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new FetchError('取得失敗', { url });
}

/**
 * URLを取得してバイト列を返す。PDFのように文字として読めないものに使う。
 * 失敗の扱いは fetchText と揃える。
 */
export async function fetchBytes(url, { userAgent, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) await sleep(RETRY_WAIT_MS);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/pdf, */*;q=0.8' },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!res.ok) {
        lastError = new FetchError('HTTP ' + res.status, { url, status: res.status });
        if (res.status >= 400 && res.status < 500) break;
        continue;
      }

      return { bytes: new Uint8Array(await res.arrayBuffer()), fetchedAt: new Date().toISOString() };
    } catch (err) {
      lastError = new FetchError(err.name === 'AbortError' ? 'タイムアウト' : err.message, { url, cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new FetchError('取得失敗', { url });
}
