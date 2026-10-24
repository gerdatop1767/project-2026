import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { NavigationProvider } from '../../lib/navigation.js';
import { getConsent, resetConsentCacheForTests, setConsent } from '../../lib/consent.js';
import { PROMO_HIDE_MS, TELEGRAM_CHANNEL_URL } from '../../lib/telegramPromo.js';
import { FloatingLayer } from './FloatingLayer.js';
import { PROMO_DELAY_MS } from '../TelegramPromo/TelegramPromo.js';

function renderLayer(path = '/') {
  window.history.replaceState(null, '', path);
  return render(
    <NavigationProvider>
      <FloatingLayer />
    </NavigationProvider>,
  );
}

const promo = () => screen.queryByRole('complementary', { name: 'Telegram-канал Зубрилки' });

describe('cookie banner', () => {
  it('asks once; «Принять» stores the choice in the zc cookie and hides the banner', () => {
    const first = renderLayer();
    expect(screen.getByRole('region', { name: 'Мы используем cookies' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
    expect(screen.queryByRole('region', { name: 'Мы используем cookies' })).toBeNull();
    expect(document.cookie).toContain('zc=a1');
    first.unmount();
    // A reload: the choice is read back, no banner.
    resetConsentCacheForTests();
    renderLayer();
    expect(screen.queryByRole('region', { name: 'Мы используем cookies' })).toBeNull();
    expect(getConsent()).toEqual({ analytics: true });
  });

  it('«Отклонить необязательные» keeps analytics off', () => {
    renderLayer();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить необязательные' }));
    expect(getConsent()).toEqual({ analytics: false });
    expect(document.cookie).toContain('zc=a0');
  });

  it('«Подробнее» lists the categories — advertising honestly «not used»', () => {
    renderLayer();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByText('Необходимые')).toBeInTheDocument();
    expect(screen.getByText('Только с согласия')).toBeInTheDocument();
    expect(screen.getByText('Не используется')).toBeInTheDocument();
  });
});

describe('Telegram button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never shows together with the cookie banner; appears after a short pause', () => {
    renderLayer();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    expect(promo()).toBeNull();
    act(() => setConsent({ analytics: false }));
    expect(promo()).toBeNull();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    const link = screen.getByRole('link', { name: /Telegram-канал Зубрилки/ });
    expect(link).toHaveAttribute('href', TELEGRAM_CHANNEL_URL);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('× hides it for 24 hours, then it comes back', () => {
    setConsent({ analytics: true });
    const view = renderLayer();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть на сутки' }));
    expect(promo()).toBeNull();
    view.unmount();

    const again = renderLayer();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    expect(promo()).toBeNull();
    again.unmount();

    vi.setSystemTime(Date.now() + PROMO_HIDE_MS + 1000);
    renderLayer();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    expect(promo()).not.toBeNull();
  });

  it('works without storage (private mode): hidden for this page view', () => {
    setConsent({ analytics: false });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderLayer();
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть на сутки' }));
    expect(promo()).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });

  it('stays away from the task screen and the cookie-free bottom of working screens', () => {
    setConsent({ analytics: true });
    renderLayer('/login');
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS + 100));
    expect(promo()).toBeNull();
  });
});
