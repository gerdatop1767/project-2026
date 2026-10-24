import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { adminTelegramChats, createDb, schema, type Database } from '@zybrilka/db';
import { readWorkerStatus, WORKER_STATUS_KEY } from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import type { Config } from './config.js';
import { createTelegramClient, TelegramApiError } from './telegram/client.js';

/**
 * Read-only diagnostics for the Telegram bot, owner notifications and
 * broadcasts, safe to run on the server:
 *
 *   docker compose -f infra/docker-compose.yml exec worker node dist/diagnoseMain.js
 * (entry point: diagnoseMain.ts)
 *
 * Prints booleans, counts and Telegram's own safe fields only — never the
 * token, never a full webhook URL (its path can be a secret), no user data.
 * Calls only getMe and getWebhookInfo: it sends nothing, changes nothing.
 *
 * `network` answers «why do requests to Telegram fail from this machine»:
 * the DNS answer for api.telegram.org (IPv4 / IPv6), a TLS handshake to
 * each address (no HTTP request, so no token is involved), Node's address
 * selection settings, and several timed getMe calls with their error codes.
 */
export const TELEGRAM_HOST = 'api.telegram.org';

type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;
type TlsProbe = (address: string, servername: string) => Promise<void>;

const defaultLookup: LookupAll = (host) => dns.promises.lookup(host, { all: true });

const defaultTlsProbe: TlsProbe = (address, servername) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host: address, port: 443, servername, timeout: 10_000 });
    socket.once('secureConnect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
    });
    socket.once('error', reject);
  });

const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'ERROR';
};

export async function probeNetwork(
  deps: { lookup?: LookupAll; tlsProbe?: TlsProbe; now?: () => number } = {},
) {
  const lookup = deps.lookup ?? defaultLookup;
  const tlsProbe = deps.tlsProbe ?? defaultTlsProbe;
  const now = deps.now ?? (() => performance.now());
  const report: Record<string, unknown> = {
    node: process.version,
    autoSelectFamily: net.getDefaultAutoSelectFamily(),
    autoSelectFamilyAttemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(),
    dnsResultOrder: dns.getDefaultResultOrder(),
    // Node's fetch ignores these unless NODE_USE_ENV_PROXY is set.
    proxyEnvSet: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
  };
  let addresses: { address: string; family: number }[] = [];
  const t0 = now();
  try {
    addresses = await lookup(TELEGRAM_HOST);
    report.dns = {
      ms: Math.round(now() - t0),
      ipv4: addresses.filter((a) => a.family === 4).map((a) => a.address),
      ipv6: addresses.filter((a) => a.family === 6).map((a) => a.address),
    };
  } catch (error) {
    report.dns = { ms: Math.round(now() - t0), error: codeOf(error) };
  }
  report.tls = await Promise.all(
    addresses.slice(0, 6).map(async ({ address, family }) => {
      const start = now();
      try {
        await tlsProbe(address, TELEGRAM_HOST);
        return { address, family, ok: true, ms: Math.round(now() - start) };
      } catch (error) {
        return { address, family, ok: false, ms: Math.round(now() - start), error: codeOf(error) };
      }
    }),
  );
  return report;
}

export async function diagnose(
  config: Config,
  deps: {
    fetch?: typeof fetch;
    db?: Database;
    network?: Parameters<typeof probeNetwork>[0];
    getMeAttempts?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    config: {
      botTokenSet: Boolean(config.TELEGRAM_BOT_TOKEN),
      polling: config.TELEGRAM_BOT_POLLING,
      healthCheckUrlSet: Boolean(config.API_HEALTH_URL),
      site: new URL(config.WEB_BASE_URL).host,
      owners: config.ADMIN_OWNER_USER_IDS.length,
      databaseUrlSet: Boolean(config.DATABASE_URL),
    },
  };

  if (config.TELEGRAM_BOT_TOKEN) {
    const telegram = createTelegramClient({
      token: config.TELEGRAM_BOT_TOKEN,
      timeoutMs: config.TELEGRAM_REQUEST_TIMEOUT_MS,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    report.network = await probeNetwork(deps.network);
    // Several calls: an intermittent network shows up as a mix of results.
    const attempts: Record<string, unknown>[] = [];
    let username: string | null = null;
    for (let i = 0; i < (deps.getMeAttempts ?? 5); i++) {
      const start = performance.now();
      try {
        const me = await telegram.getMe();
        username = me.username ?? null;
        attempts.push({ ok: true, ms: Math.round(performance.now() - start) });
      } catch (error) {
        attempts.push({
          ok: false,
          ms: Math.round(performance.now() - start),
          kind: error instanceof TelegramApiError ? error.kind : 'unexpected',
          code: error instanceof TelegramApiError ? (error.network?.code ?? null) : null,
          timeout: error instanceof TelegramApiError ? (error.network?.timeout ?? false) : false,
        });
      }
    }
    report.bot = { username, getMe: attempts };
    try {
      const info = await telegram.getWebhookInfo();
      let host: string | null = null;
      try {
        host = info.url ? new URL(info.url).host : null;
      } catch {
        host = 'unparseable';
      }
      report.webhook = {
        set: Boolean(info.url),
        host,
        pendingUpdateCount: info.pending_update_count,
        lastErrorMessage: info.last_error_message ?? null,
        lastErrorAt: info.last_error_date
          ? new Date(info.last_error_date * 1000).toISOString()
          : null,
        allowedUpdates: info.allowed_updates ?? null,
      };
    } catch (error) {
      report.webhook = { error: error instanceof TelegramApiError ? error.kind : 'unexpected' };
    }
  }

  const database = deps.db ? null : config.DATABASE_URL ? createDb(config.DATABASE_URL) : null;
  const db = deps.db ?? database?.db;
  if (db) {
    try {
      const [chats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          blocked: sql<number>`count(*) FILTER (WHERE blocked_at IS NOT NULL)::int`,
        })
        .from(schema.telegramBotChats);
      const outbox = await db
        .select({
          kind: schema.telegramOutbox.kind,
          status: schema.telegramOutbox.status,
          lastError: schema.telegramOutbox.lastError,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.telegramOutbox)
        .where(sql`${schema.telegramOutbox.createdAt} > now() - interval '7 days'`)
        .groupBy(
          schema.telegramOutbox.kind,
          schema.telegramOutbox.status,
          schema.telegramOutbox.lastError,
        );
      const [status] = await db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, WORKER_STATUS_KEY));
      const broadcasts = await db
        .select({ status: schema.broadcasts.status, n: sql<number>`count(*)::int` })
        .from(schema.broadcasts)
        .groupBy(schema.broadcasts.status);
      report.database = {
        botChats: chats,
        ownersWithTelegram: (await adminTelegramChats(db, config.ADMIN_OWNER_USER_IDS)).length,
        outboxLast7Days: outbox,
        broadcasts,
        workerStatus: status ? readWorkerStatus(status.value) : null,
      };
    } catch (error) {
      report.database = { error: (error as { code?: string }).code ?? 'query_failed' };
    } finally {
      await database?.close();
    }
  }
  return report;
}
