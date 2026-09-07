// Blogger API v3 への投稿。
//
// 重要な制約: Blogger API はカスタムパーマリンクを直接指定できない。
// サーバがタイトルからURLを生成するため、日本語タイトルのままだと
// blog-post_7.html のような無意味なURLになる（仕様Q27が満たせない）。
//
// そこで自動公開する記事は次の順序で作る。
//   1. ASCIIのパーマリンク文字列をタイトルにして公開する（この時点でURLが確定する）
//   2. すぐに本来の日本語タイトルへ差し替える
// 手順1と2の間だけタイトルがローマ字になるが、実時間で1秒未満。
//
// 下書き（要確認）の記事はこの操作をしない。人が公開するときに
// Blogger の画面でパーマリンクを設定できるため、無理をする必要がない。

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/blogger/v3';

export class PublisherError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'PublisherError';
    this.status = status;
    this.body = body;
  }
}

export function readCredentials(env = process.env) {
  const c = {
    blogId: env.BLOGGER_BLOG_ID,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  };
  const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new PublisherError(`認証情報が不足しています: ${missing.join(', ')}`);
  }
  return c;
}

export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PublisherError(`アクセストークンの取得に失敗: ${json.error ?? res.status}`, {
      status: res.status, body: json,
    });
  }
  return json.access_token;
}

async function api(token, path, { method = 'GET', body = null, query = {} } = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PublisherError(`Blogger API ${method} ${path} が失敗: ${json?.error?.message ?? res.status}`, {
      status: res.status, body: json,
    });
  }
  return json;
}

export class BloggerPublisher {
  constructor({ credentials, dryRun = false }) {
    this.credentials = credentials;
    this.dryRun = dryRun;
    this.token = null;
  }

  async auth() {
    if (this.dryRun) return;
    if (!this.token) this.token = await getAccessToken(this.credentials);
  }

  /** 自動公開。URLを確定させるため、いったんローマ字タイトルで公開してから改題する */
  async createPublished(article) {
    if (this.dryRun) {
      return { id: 'dry-run', url: `(dry-run)/${article.permalink}.html`, dryRun: true };
    }
    await this.auth();
    const blogId = this.credentials.blogId;

    const created = await api(this.token, `/blogs/${blogId}/posts/`, {
      method: 'POST',
      body: { kind: 'blogger#post', title: article.permalink, content: article.body },
      query: { isDraft: false },
    });

    const renamed = await api(this.token, `/blogs/${blogId}/posts/${created.id}`, {
      method: 'PATCH',
      body: { title: article.title, labels: article.labels },
    });

    return { id: renamed.id, url: renamed.url ?? created.url ?? null };
  }

  /** 要確認の記事は下書きのまま置く。パーマリンクは公開時に人が設定する */
  async createDraft(article) {
    if (this.dryRun) return { id: 'dry-run', url: null, isDraft: true, dryRun: true };
    await this.auth();
    const created = await api(this.token, `/blogs/${this.credentials.blogId}/posts/`, {
      method: 'POST',
      body: { kind: 'blogger#post', title: article.title, content: article.body, labels: article.labels },
      query: { isDraft: true },
    });
    return { id: created.id, url: created.url ?? null, isDraft: true };
  }

  /** 続報。同じ記事を更新する（仕様Q20）。URLは変わらない */
  async update(postId, article) {
    if (this.dryRun) return { id: postId, url: null, dryRun: true };
    await this.auth();
    const updated = await api(this.token, `/blogs/${this.credentials.blogId}/posts/${postId}`, {
      method: 'PATCH',
      body: { title: article.title, content: article.body, labels: article.labels },
    });
    return { id: updated.id, url: updated.url ?? null };
  }

  /** 投稿を削除する。試験投稿の後始末と、誤投稿の撤回に使う */
  async deletePost(postId) {
    if (this.dryRun) return { deleted: postId, dryRun: true };
    await this.auth();
    await api(this.token, `/blogs/${this.credentials.blogId}/posts/${postId}`, {
      method: 'DELETE',
    });
    return { deleted: postId };
  }

  /** 常設ページ（仕様Q19）。既存ページがあれば更新、無ければ作成 */
  async upsertPage(pageId, { title, body }) {
    if (this.dryRun) return { id: pageId ?? 'dry-run', dryRun: true };
    await this.auth();
    const blogId = this.credentials.blogId;
    if (pageId) {
      const r = await api(this.token, `/blogs/${blogId}/pages/${pageId}`, {
        method: 'PATCH',
        body: { title, content: body },
      });
      return { id: r.id, url: r.url ?? null };
    }
    const r = await api(this.token, `/blogs/${blogId}/pages/`, {
      method: 'POST',
      body: { kind: 'blogger#page', title, content: body },
    });
    return { id: r.id, url: r.url ?? null };
  }
}
