import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 3000 });
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
  });

  describe('empty-string env vars (Docker Compose `${VAR}` substitutes an empty string, never an absent key, for an unset variable)', () => {
    it('falls back to the default instead of crashing when WEB_BASE_URL (z.url) is set to the empty string', () => {
      const config = loadConfig({ WEB_BASE_URL: '' });
      expect(config.WEB_BASE_URL).toBe('http://localhost:5173');
    });

    it('falls back to the default instead of crashing when SMTP_PORT (z.coerce.number) is set to the empty string', () => {
      const config = loadConfig({ SMTP_PORT: '' });
      expect(config.SMTP_PORT).toBe(587);
    });

    it('treats an empty VK_REDIRECT_URI (z.url().optional()) the same as unset — isVkConfigured stays false, not a thrown error', () => {
      const config = loadConfig({
        VK_CLIENT_ID: 'id',
        VK_CLIENT_SECRET: 'secret',
        VK_REDIRECT_URI: '',
      });
      expect(config.VK_REDIRECT_URI).toBeUndefined();
    });

    it('treats an empty SMTP_HOST (z.string().optional()) the same as unset', () => {
      const config = loadConfig({ SMTP_HOST: '' });
      expect(config.SMTP_HOST).toBeUndefined();
    });

    it('a genuinely non-empty value is never touched by the empty-string handling', () => {
      const config = loadConfig({ WEB_BASE_URL: 'https://zybrilka.ru' });
      expect(config.WEB_BASE_URL).toBe('https://zybrilka.ru');
    });
  });
});
