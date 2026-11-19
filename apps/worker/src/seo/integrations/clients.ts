import { createSign } from 'node:crypto';
import type { HttpFetch } from '../deps.js';

/**
 * Clients for OFFICIAL APIs only (docs/SEO_CENTER.md §9). No scraping, no
 * unofficial endpoints. Every client throws IntegrationError with the
 * provider's HTTP status and a short body excerpt (never the token).
 */

export class IntegrationError extends Error {
  constructor(
    public provider: string,
    public status: number,
    detail: string,
  ) {
    super(`${provider}: HTTP ${status} ${detail}`.slice(0, 600));
  }
}

async function json<T>(provider: string, res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new IntegrationError(provider, res.status, text.slice(0, 300));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationError(provider, res.status, 'invalid JSON');
  }
}

const TIMEOUT = () => AbortSignal.timeout(30_000);

// ── Yandex Webmaster API v4 ─────────────────────────────────────────────
// https://api.webmaster.yandex.net/v4, header `Authorization: OAuth <token>`.
// NOTE: endpoint paths/fields follow API v4 as known at implementation time;
// the docs were not reachable from the build environment — the integration
// check (admin → Интеграции → Проверить) reports any mismatch verbatim.

export interface WebmasterQuery {
  query: string;
  shows: number;
  clicks: number;
  position: number | null;
}

export class YandexWebmaster {
  private readonly base = 'https://api.webmaster.yandex.net/v4';
  constructor(
    private readonly fetch: HttpFetch,
    private readonly token: string,
  ) {}

  private get<T>(path: string) {
    return this.fetch(`${this.base}${path}`, {
      headers: { Authorization: `OAuth ${this.token}` },
      signal: TIMEOUT(),
    }).then((r) => json<T>('yandex_webmaster', r));
  }

  async userId(): Promise<number> {
    return (await this.get<{ user_id: number }>('/user')).user_id;
  }

  /** Finds the verified host for the site URL (https://zybrilka.ru). */
  async hostId(userId: number, siteUrl: string): Promise<string> {
    const { hosts } = await this.get<{
      hosts: { host_id: string; ascii_host_url: string; verified: boolean }[];
    }>(`/user/${userId}/hosts`);
    const want = new URL(siteUrl).host;
    const host = hosts.find((h) => new URL(h.ascii_host_url).host === want && h.verified);
    if (!host)
      throw new IntegrationError(
        'yandex_webmaster',
        404,
        `verified host ${want} not found in this account`,
      );
    return host.host_id;
  }

  /** Top queries for ONE day (so rows can be stored per day). */
  async popularQueries(userId: number, hostId: string, day: string): Promise<WebmasterQuery[]> {
    const params = new URLSearchParams({
      order_by: 'TOTAL_SHOWS',
      date_from: day,
      date_to: day,
      limit: '500',
    });
    for (const i of ['TOTAL_SHOWS', 'TOTAL_CLICKS', 'AVG_SHOW_POSITION'])
      params.append('query_indicator', i);
    const data = await this.get<{
      queries: { query_text: string; indicators: Record<string, number | null> }[];
    }>(`/user/${userId}/hosts/${encodeURIComponent(hostId)}/search-queries/popular?${params}`);
    return data.queries.map((q) => ({
      query: q.query_text,
      shows: Math.round(q.indicators.TOTAL_SHOWS ?? 0),
      clicks: Math.round(q.indicators.TOTAL_CLICKS ?? 0),
      position: q.indicators.AVG_SHOW_POSITION ?? null,
    }));
  }

  async summary(userId: number, hostId: string) {
    return this.get<{
      searchable_pages_count?: number;
      excluded_pages_count?: number;
      sqi?: number;
      site_problems?: Record<string, number>;
    }>(`/user/${userId}/hosts/${encodeURIComponent(hostId)}/summary`);
  }

  /** URLs currently in Yandex search (samples, paged). */
  async inSearchSamples(userId: number, hostId: string, limit = 100, offset = 0) {
    return this.get<{ count: number; samples: { url: string; title?: string }[] }>(
      `/user/${userId}/hosts/${encodeURIComponent(hostId)}/search-urls/in-search/samples?offset=${offset}&limit=${limit}`,
    );
  }
}

// ── Yandex Metrika Reporting API ────────────────────────────────────────
// https://api-metrika.yandex.net/stat/v1/data, header `Authorization: OAuth <token>`.

export interface MetrikaRow {
  date: string;
  source: string;
  page: string;
  visits: number;
  users: number;
  goalReaches: number | null;
  avgVisitSeconds: number | null;
  bounceRate: number | null;
}

export class YandexMetrika {
  constructor(
    private readonly fetch: HttpFetch,
    private readonly token: string,
    private readonly counterId: number,
    private readonly goalId?: number,
  ) {}

  private async data(params: Record<string, string>) {
    const q = new URLSearchParams({
      ids: String(this.counterId),
      accuracy: 'full',
      limit: '10000',
      ...params,
    });
    const res = await this.fetch(`https://api-metrika.yandex.net/stat/v1/data?${q}`, {
      headers: { Authorization: `OAuth ${this.token}` },
      signal: TIMEOUT(),
    });
    return json<{
      data: { dimensions: { name: string | null; id?: string | null }[]; metrics: number[] }[];
    }>('yandex_metrika', res);
  }

  private metrics() {
    const m = ['ym:s:visits', 'ym:s:users', 'ym:s:avgVisitDurationSeconds', 'ym:s:bounceRate'];
    if (this.goalId) m.push(`ym:s:goal${this.goalId}reaches`);
    return m.join(',');
  }

  private row(date: string, source: string, page: string, metrics: number[]): MetrikaRow {
    return {
      date,
      source,
      page,
      visits: Math.round(metrics[0] ?? 0),
      users: Math.round(metrics[1] ?? 0),
      avgVisitSeconds: metrics[2] ?? null,
      bounceRate: metrics[3] ?? null,
      goalReaches: this.goalId ? Math.round(metrics[4] ?? 0) : null,
    };
  }

  /** Whole site: per day × traffic source (organic, direct, referral, social, ad, …). */
  async bySource(from: string, to: string): Promise<MetrikaRow[]> {
    const r = await this.data({
      date1: from,
      date2: to,
      dimensions: 'ym:s:date,ym:s:trafficSource',
      metrics: this.metrics(),
    });
    return r.data.map((d) =>
      this.row(
        d.dimensions[0]!.name!,
        d.dimensions[1]!.id ?? d.dimensions[1]!.name ?? 'unknown',
        '',
        d.metrics,
      ),
    );
  }

  /** Blog landing pages: per day × page (all sources and organic separately). */
  async blogPages(from: string, to: string): Promise<MetrikaRow[]> {
    const base = {
      date1: from,
      date2: to,
      dimensions: 'ym:s:date,ym:s:startURLPath',
      metrics: this.metrics(),
      filters: "ym:s:startURLPath=@'/blog/'",
    };
    const [all, organic] = await Promise.all([
      this.data(base),
      this.data({ ...base, filters: `${base.filters} AND ym:s:trafficSource=='organic'` }),
    ]);
    return [
      ...all.data.map((d) =>
        this.row(d.dimensions[0]!.name!, 'all', d.dimensions[1]!.name ?? '', d.metrics),
      ),
      ...organic.data.map((d) =>
        this.row(d.dimensions[0]!.name!, 'organic', d.dimensions[1]!.name ?? '', d.metrics),
      ),
    ];
  }
}

// ── Google Search Console (service account, JWT bearer) ─────────────────

export interface GscRow {
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export class GoogleSearchConsole {
  private token: { value: string; exp: number } | null = null;
  constructor(
    private readonly fetch: HttpFetch,
    private readonly serviceAccountJson: string,
    private readonly siteUrl: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const sa = JSON.parse(this.serviceAccountJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
    };
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(sa.private_key)
      .toString('base64url');
    const res = await this.fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: TIMEOUT(),
    });
    const t = await json<{ access_token: string; expires_in: number }>('google_oauth', res);
    this.token = { value: t.access_token, exp: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  async query(
    from: string,
    to: string,
    dimensions: ('date' | 'page' | 'query')[] = ['date', 'page', 'query'],
  ): Promise<GscRow[]> {
    const out: GscRow[] = [];
    for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
      const res = await this.fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await this.accessToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dimensions,
            rowLimit: 25_000,
            startRow,
            dataState: 'final',
          }),
          signal: TIMEOUT(),
        },
      );
      const data = await json<{
        rows?: { keys: string[]; clicks: number; impressions: number; position: number }[];
      }>('google_search_console', res);
      for (const r of data.rows ?? []) {
        const k = Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i] ?? '']));
        out.push({
          date: k.date ?? '',
          page: k.page ?? '',
          query: k.query ?? '',
          clicks: r.clicks,
          impressions: r.impressions,
          position: r.position,
        });
      }
      if ((data.rows?.length ?? 0) < 25_000) break;
    }
    return out;
  }
}

// ── IndexNow (Yandex, Bing) ─────────────────────────────────────────────

export async function indexNowPing(fetch: HttpFetch, origin: string, key: string, urls: string[]) {
  const host = new URL(origin).host;
  const res = await fetch('https://yandex.com/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${origin}/blog/indexnow-${key}.txt`,
      urlList: urls,
    }),
    signal: TIMEOUT(),
  });
  // 200 OK and 202 Accepted are both success.
  if (res.status !== 200 && res.status !== 202)
    throw new IntegrationError('indexnow', res.status, (await res.text()).slice(0, 200));
  return res.status;
}

// ── Telegram channel (Bot API) ──────────────────────────────────────────

export async function telegramChannelPost(
  fetch: HttpFetch,
  botToken: string,
  channelId: string,
  html: string,
) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: false },
    }),
    signal: TIMEOUT(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id: number; chat?: { username?: string } };
    description?: string;
  };
  // Never include the token in the error.
  if (!data.ok) throw new IntegrationError('telegram', res.status, data.description ?? 'error');
  const username =
    data.result?.chat?.username ?? (channelId.startsWith('@') ? channelId.slice(1) : null);
  return {
    messageId: data.result!.message_id,
    url: username ? `https://t.me/${username}/${data.result!.message_id}` : null,
  };
}

export async function telegramChannelCheck(fetch: HttpFetch, botToken: string, channelId: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(channelId)}`,
    { signal: TIMEOUT() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { title?: string };
  };
  if (!data.ok) throw new IntegrationError('telegram', res.status, data.description ?? 'error');
  return data.result?.title ?? channelId;
}

// ── VK (community wall, official API) ──────────────────────────────────

export async function vkWallPost(
  fetch: HttpFetch,
  token: string,
  groupId: number,
  message: string,
  attachmentUrl: string,
) {
  const body = new URLSearchParams({
    owner_id: `-${groupId}`,
    from_group: '1',
    message,
    attachments: attachmentUrl,
    v: '5.199',
  });
  const res = await fetch('https://api.vk.com/method/wall.post', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: TIMEOUT(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    response?: { post_id: number };
    error?: { error_code: number; error_msg: string };
  };
  if (!data.response)
    throw new IntegrationError(
      'vk',
      data.error?.error_code ?? res.status,
      data.error?.error_msg ?? 'error',
    );
  return {
    postId: data.response.post_id,
    url: `https://vk.com/wall-${groupId}_${data.response.post_id}`,
  };
}
