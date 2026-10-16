import { type Database } from '@zybrilka/db';
import { buildApp, type AppOptions } from './app.js';
import type { Config } from './config.js';

/**
 * The one place the production entrypoint (`server.ts`) turns a loaded
 * `Config` into an app. Kept separate from `server.ts` (which listens on
 * a port as a side effect of being imported) so the wiring itself is
 * testable.
 *
 * `authConfig` MUST be passed here: `buildApp` only registers the auth
 * routes (`/api/v1/auth/*` — magic-link, VK ID, `me`, logout), the cookie
 * plugin and the session hook when it is given. `server.ts` used to call
 * `buildApp` without it, so in production every auth route silently
 * 404'd even though the code, the tests (which pass `authConfig`
 * explicitly) and the reverse-proxy routing were all correct.
 */
export function createApp(
  config: Config,
  db: Database | undefined,
  checkDb?: AppOptions['checkDb'],
) {
  return buildApp({
    logger: { level: config.LOG_LEVEL },
    version: config.APP_VERSION,
    checkDb,
    db,
    authConfig: config,
    // In production the API is reachable only from Caddy (compose
    // exposes no host port; Caddy overwrites any client-supplied
    // X-Forwarded-For with the real client IP). Without this every
    // visitor would share the proxy's IP and thus ONE auth rate-limit
    // bucket (10 magic-link emails per 10 minutes for the whole site).
    trustProxy: config.NODE_ENV === 'production',
  });
}
