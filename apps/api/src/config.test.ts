import { describe, expect, it } from 'vitest';
import { loadConfig, normalizeBotToken } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 3000 });
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  describe('ADMIN_OWNER_USER_IDS', () => {
    it('grants nobody by default', () => {
      expect(loadConfig({}).ADMIN_OWNER_USER_IDS).toEqual([]);
      expect(loadConfig({ ADMIN_OWNER_USER_IDS: '' }).ADMIN_OWNER_USER_IDS).toEqual([]);
      expect(loadConfig({ ADMIN_OWNER_USER_IDS: ' , ' }).ADMIN_OWNER_USER_IDS).toEqual([]);
    });

    it('parses a comma-separated list of uuids (trimmed, lowercased)', () => {
      const id = '0F8FAD5B-D9CB-469F-A165-70867728950E';
      expect(loadConfig({ ADMIN_OWNER_USER_IDS: ` ${id} ` }).ADMIN_OWNER_USER_IDS).toEqual([
        id.toLowerCase(),
      ]);
    });

    it('fails startup on anything that is not a uuid (no silent "admin for nobody/everybody")', () => {
      expect(() => loadConfig({ ADMIN_OWNER_USER_IDS: 'owner@example.com' })).toThrow(
        /ADMIN_OWNER_USER_IDS/,
      );
      expect(() => loadConfig({ ADMIN_OWNER_USER_IDS: '*' })).toThrow(/ADMIN_OWNER_USER_IDS/);
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  describe('empty-string env vars (Docker Compose `${VAR}` substitutes an empty string, never an absent key, for an unset variable)', () => {
    it('falls back to the default instead of crashing when WEB_BASE_URL (z.url) is set to the empty string', () => {
      const config = loadConfig({ WEB_BASE_URL: '' });
      expect(config.WEB_BASE_URL).toBe('http://localhost:5173');
    });

    it('falls back to the default instead of crashing when YANDEX_REQUEST_TIMEOUT_MS (z.coerce.number) is set to the empty string', () => {
      const config = loadConfig({ YANDEX_REQUEST_TIMEOUT_MS: '' });
      expect(config.YANDEX_REQUEST_TIMEOUT_MS).toBe(5000);
    });

    it('treats an empty VK_REDIRECT_URI (z.url().optional()) the same as unset — isVkConfigured stays false, not a thrown error', () => {
      const config = loadConfig({
        VK_CLIENT_ID: 'id',
        VK_CLIENT_SECRET: 'secret',
        VK_REDIRECT_URI: '',
      });
      expect(config.VK_REDIRECT_URI).toBeUndefined();
    });

    it('treats empty YANDEX_* values the same as unset', () => {
      const config = loadConfig({ YANDEX_CLIENT_ID: '', YANDEX_REDIRECT_URI: '' });
      expect(config.YANDEX_CLIENT_ID).toBeUndefined();
      expect(config.YANDEX_REDIRECT_URI).toBeUndefined();
    });

    it('ignores leftover SMTP_* variables from an older .env (no longer read)', () => {
      const config = loadConfig({ SMTP_HOST: 'smtp.yandex.ru', SMTP_PORT: '465' });
      expect(config).not.toHaveProperty('SMTP_HOST');
    });

    it('a genuinely non-empty value is never touched by the empty-string handling', () => {
      const config = loadConfig({ WEB_BASE_URL: 'https://zybrilka.ru' });
      expect(config.WEB_BASE_URL).toBe('https://zybrilka.ru');
    });
  });
});

describe('TELEGRAM_BOT_TOKEN normalization', () => {
  const token = '123456789:AAFexampleExampleExampleExampleExample1';

  it.each([
    ['plain', token],
    ['trailing newline (editor / CRLF .env)', `${token}\r\n`],
    ['surrounding spaces', `  ${token} `],
    ['double quotes', `"${token}"`],
    ['single quotes', `'${token}'`],
    ['the "bot" prefix of Bot API URLs', `bot${token}`],
  ])('accepts a token pasted with %s', (_name, raw) => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: raw }).TELEGRAM_BOT_TOKEN).toBe(token);
  });

  it('treats blank / whitespace-only / empty-quotes values as not configured', () => {
    for (const raw of ['', '   ', '\n', '""']) {
      expect(loadConfig({ TELEGRAM_BOT_TOKEN: raw }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    }
    expect(loadConfig({}).TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it('never alters the inside of a token', () => {
    expect(normalizeBotToken('123456:AB-cd_EF')).toBe('123456:AB-cd_EF');
    expect(normalizeBotToken('bot')).toBe('bot');
  });
});
