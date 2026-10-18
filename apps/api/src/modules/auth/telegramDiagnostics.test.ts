import { Writable } from 'node:stream';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { signTelegramInitData, telegramLaunch } from '../../testSupport.js';
import { authProvidersSummary, logAuthProviders } from './providersStatus.js';
import { describeBotToken, verifyTelegramInitData, type TelegramAuthError } from './telegram.js';

const TOKEN = '123456789:AAFexampleExampleExampleExampleExample1';
const NOW = 1_800_000_000;
const opts = { maxAgeSeconds: 3600, nowSeconds: NOW };

function failure(initData: string, token = TOKEN): TelegramAuthError {
  try {
    verifyTelegramInitData(initData, token, opts);
  } catch (error) {
    return error as TelegramAuthError;
  }
  throw new Error('expected a rejection');
}

describe('rejection diagnostics (what an operator can learn without any secret)', () => {
  const launch = (token = TOKEN) =>
    telegramLaunch(
      token,
      { id: 42, first_name: 'Секретное', last_name: 'Имя' },
      { authDate: NOW - 20 },
    );

  it('bad_signature reports size, field names and age — and nothing else', () => {
    const error = failure(launch('999:wrong-bot-token'));
    expect(error.reason).toBe('bad_signature');
    expect(error.diagnostics).toMatchObject({
      fields: ['auth_date', 'hash', 'query_id', 'signature', 'user'],
      ageSeconds: 20,
      matchesWithoutSignatureField: false,
    });
    const dump = JSON.stringify(error.diagnostics);
    expect(dump).not.toContain('Секретное');
    expect(dump).not.toMatch(/[0-9a-f]{64}/); // no hash value
    expect(dump).not.toContain(TOKEN);
  });

  it('tells a wrong token from an algorithm difference: a hash over the data WITHOUT `signature` is reported, never accepted', () => {
    const fields = {
      auth_date: String(NOW - 5),
      query_id: 'AAH',
      signature: 'ed25519-signature-value',
      user: JSON.stringify({ id: 7, first_name: 'A' }),
    };
    const withoutSignature = {
      auth_date: fields.auth_date,
      query_id: fields.query_id,
      user: fields.user,
    };
    const error = failure(
      signTelegramInitData(
        TOKEN,
        { ...withoutSignature, signature: fields.signature },
        {
          hash: new URLSearchParams(signTelegramInitData(TOKEN, withoutSignature)).get('hash')!,
        },
      ),
    );
    expect(error.reason).toBe('bad_signature'); // still refused
    expect(error.diagnostics?.matchesWithoutSignatureField).toBe(true);
  });

  it('other rejections carry diagnostics too (expired shows how old)', () => {
    const error = failure(telegramLaunch(TOKEN, { id: 1 }, { authDate: NOW - 7200 }));
    expect(error.reason).toBe('expired');
    expect(error.diagnostics?.ageSeconds).toBe(7200);
  });

  it('forged field names cannot inject odd strings into a log', () => {
    const params = new URLSearchParams(launch());
    params.set('x'.repeat(200), '1');
    params.set('bad name\n{"level":60}', '1');
    const names = failure(params.toString()).diagnostics?.fields ?? [];
    expect(names.every((name) => /^[a-z_]{1,24}$/.test(name))).toBe(true);
  });
});

describe('describeBotToken / startup summary', () => {
  it('exposes only the public bot id, never the secret part', () => {
    expect(describeBotToken(TOKEN)).toEqual({
      configured: true,
      botId: '123456789',
      formatLooksValid: true,
    });
    expect(JSON.stringify(describeBotToken(TOKEN))).not.toContain('AAF');
    expect(describeBotToken(undefined)).toEqual({ configured: false });
    expect(describeBotToken('not-a-token')).toEqual({ configured: true, formatLooksValid: false });
  });

  it('logs one summary, and warns when Telegram is off or the token looks wrong', () => {
    const lines: { level: string; obj: Record<string, unknown> }[] = [];
    const log = {
      info: (obj: object) => lines.push({ level: 'info', obj: obj as Record<string, unknown> }),
      warn: (obj: object) => lines.push({ level: 'warn', obj: obj as Record<string, unknown> }),
    };
    logAuthProviders(log, loadConfig({}));
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn']);
    expect(lines[1]!.obj).toEqual({ tgAuth: 'not_configured' });

    lines.length = 0;
    logAuthProviders(log, loadConfig({ TELEGRAM_BOT_TOKEN: 'garbage' }));
    expect(lines[1]!.obj).toEqual({ tgAuth: 'token_format' });

    lines.length = 0;
    logAuthProviders(log, loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN }));
    expect(lines).toHaveLength(1);
    expect(authProvidersSummary(loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).telegram.botId).toBe(
      '123456789',
    );
  });
});

describe('POST /auth/telegram: what reaches the logs', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  let app: ReturnType<typeof buildApp>;
  let unconfigured: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: `${TOKEN}\n` }),
      logger: { level: 'info', stream },
    });
    unconfigured = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
      logger: { level: 'info', stream },
    });
  });
  afterEach(() => (lines.length = 0));
  afterAll(async () => {
    await app.close();
    await unconfigured.close();
    await testDb.close();
  });

  const post = (target: typeof app, initData: string) =>
    target.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData } });

  it('a token saved with a trailing newline still works (normalized once, at startup)', async () => {
    const res = await post(app, telegramLaunch(TOKEN, { id: 31337, first_name: 'Ok' }));
    expect(res.statusCode).toBe(200);
  });

  it('a rejected launch logs reason + diagnostics but not the data, hash, token or names', async () => {
    const initData = telegramLaunch('1:other-bot', { id: 5, first_name: 'ЛичноеИмя' });
    const hash = new URLSearchParams(initData).get('hash')!;
    const res = await post(app, initData);
    expect(res.statusCode).toBe(401);
    const out = lines.join('');
    expect(out).toContain('"tgAuth":"bad_signature"');
    expect(out).toContain('"fields":');
    expect(out).not.toContain(hash);
    expect(out).not.toContain('ЛичноеИмя');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(encodeURIComponent('ЛичноеИмя'));
  });

  it('an unconfigured server answers 503 AND says so in the log (it used to be silent)', async () => {
    const res = await post(unconfigured, telegramLaunch(TOKEN, { id: 9 }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'telegram_not_configured' });
    expect(lines.join('')).toContain('"tgAuth":"not_configured"');
  });
});
