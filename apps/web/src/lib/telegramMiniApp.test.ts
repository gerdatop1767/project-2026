import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  window.location.hash = '';
  delete window.Telegram;
  delete document.documentElement.dataset.telegram;
  vi.resetModules();
});

async function loadWithHash(hash: string) {
  window.location.hash = hash;
  vi.resetModules();
  return import('./telegramMiniApp.js');
}

describe('telegramMiniApp', () => {
  it('is not a Mini App for ordinary visitors', async () => {
    const mod = await loadWithHash('');
    expect(mod.getTelegramInitData()).toBeNull();
    expect(mod.isTelegramMiniApp()).toBe(false);
    mod.prepareTelegramApp();
    expect(document.documentElement.dataset.telegram).toBeUndefined();
    expect(document.querySelector('script[src*="telegram-web-app"]')).toBeNull();
  });

  it('reads the signed launch data from the URL hash, decoded once', async () => {
    const initData = 'query_id=AAH&user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc';
    const mod = await loadWithHash(
      `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0`,
    );
    expect(mod.getTelegramInitData()).toBe(initData);
    expect(mod.isTelegramMiniApp()).toBe(true);
  });

  it('prefers the live WebApp.initData when Telegram injected it', async () => {
    const mod = await loadWithHash('');
    window.Telegram = { WebApp: { initData: 'from=webapp' } };
    expect(mod.getTelegramInitData()).toBe('from=webapp');
  });

  it('inside Telegram: marks the document and loads the official helper once', async () => {
    const mod = await loadWithHash(`#tgWebAppData=${encodeURIComponent('a=b&hash=c')}`);
    mod.prepareTelegramApp();
    mod.prepareTelegramApp();
    expect(document.documentElement.dataset.telegram).toBe('true');
    expect(
      document.querySelectorAll('script[src="https://telegram.org/js/telegram-web-app.js"]'),
    ).toHaveLength(1);
    document.querySelectorAll('script[src*="telegram-web-app"]').forEach((node) => node.remove());
  });

  it('calls ready() and expand() when the helper is already present', async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    const mod = await loadWithHash('');
    window.Telegram = { WebApp: { initData: 'a=b&hash=c', ready, expand } };
    mod.prepareTelegramApp();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledTimes(1);
  });
});
