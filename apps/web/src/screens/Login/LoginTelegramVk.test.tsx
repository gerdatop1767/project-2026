import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider } from '../../lib/authTestUtils.js';
import { Login } from './Login.js';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';
import type * as TelegramModule from '../../lib/telegramMiniApp.js';

// Inside the Telegram Mini App (the WebView flag the real module derives
// from Telegram's launch data / this WebView session).
vi.mock('../../lib/telegramMiniApp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramModule>()),
  isInTelegramWebView: () => true,
}));

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api.js');
  return {
    ...actual,
    startVkHandoff: vi.fn(),
    claimVkHandoff: vi.fn(),
    vkLoginUrl: vi.fn(() => 'https://zybrilka.test/api/v1/auth/vk/start'),
  };
});

const START_URL = 'https://zybrilka.test/api/v1/auth/vk/start?handoff=one-time-start-token';
const openLink = vi.fn();

beforeEach(() => {
  window.Telegram = { WebApp: { openLink } };
  vi.mocked(api.startVkHandoff).mockResolvedValue({ startUrl: START_URL });
  vi.mocked(api.claimVkHandoff).mockResolvedValue({ status: 'pending' });
});
afterEach(() => {
  delete window.Telegram;
  window.sessionStorage.clear();
  openLink.mockReset();
  vi.useRealTimers();
});

function renderLogin(refresh = vi.fn(async () => {})) {
  window.history.pushState(null, '', '/login');
  render(
    <NavigationProvider>
      <TestAuthProvider user={null} refresh={refresh}>
        <Login />
      </TestAuthProvider>
    </NavigationProvider>,
  );
  return { refresh };
}

const vkButton = () => screen.findByRole('button', { name: /Продолжить через VK ID/ });

describe('Login inside the Telegram Mini App — VK ID in the external browser', () => {
  it('does not offer Yandex ID inside the Mini App (Telegram signs the user in there)', async () => {
    renderLogin();
    await vkButton();
    expect(screen.queryByRole('button', { name: /Войти через Яндекс/ })).not.toBeInTheDocument();
  });

  it('prepares the handoff up front, and the tap opens VK ID in the external browser via Telegram.WebApp.openLink', async () => {
    const user = userEvent.setup();
    renderLogin();
    await waitFor(() => expect(api.startVkHandoff).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await vkButton()).toBeEnabled());
    expect(screen.getByText(/Откроется в браузере/)).toBeInTheDocument();

    await user.click(await vkButton());
    // Synchronously, with the real start URL — never inside the WebView.
    expect(openLink).toHaveBeenCalledWith(START_URL);
    expect(screen.getByText('Ждём вход через VK ID')).toBeInTheDocument();
    // Repeated taps can't start a second flow: the button is gone while waiting.
    expect(
      screen.queryByRole('button', { name: /Продолжить через VK ID/ }),
    ).not.toBeInTheDocument();
  });

  it('when VK sign-in finishes in the browser, the Mini App claims its own session and refreshes the user', async () => {
    const user = userEvent.setup();
    const { refresh } = renderLogin();
    await user.click(await vkButton());
    await waitFor(() => expect(openLink).toHaveBeenCalled());

    vi.mocked(api.claimVkHandoff).mockResolvedValue({ status: 'ok' });
    // Coming back to Telegram triggers an immediate check.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a cancelled VK screen: says so and offers the button again with a fresh link', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(await vkButton());
    vi.mocked(api.claimVkHandoff).mockResolvedValue({ status: 'cancelled' });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText(/Вход через VK ID отменён/)).toBeInTheDocument();
    await waitFor(() => expect(api.startVkHandoff).toHaveBeenCalledTimes(2));
    expect(await vkButton()).toBeInTheDocument();
  });

  it('a VK error: an honest message, and the button again', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(await vkButton());
    vi.mocked(api.claimVkHandoff).mockResolvedValue({ status: 'failed' });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText(/Не удалось войти через VK ID/)).toBeInTheDocument();
    expect(await vkButton()).toBeInTheDocument();
  });

  it('«Начать заново» abandons the open attempt and prepares a new link', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(await vkButton());
    await user.click(screen.getByRole('button', { name: 'Начать заново' }));
    await waitFor(() => expect(api.startVkHandoff).toHaveBeenCalledTimes(2));
    expect(await vkButton()).toBeInTheDocument();
  });

  it('Telegram reloaded the Mini App while VK ID was open in the browser: it keeps waiting, then signs in', async () => {
    vi.mocked(api.claimVkHandoff).mockResolvedValueOnce({ status: 'pending', started: true });
    const { refresh } = renderLogin();
    expect(await screen.findByText('Ждём вход через VK ID')).toBeInTheDocument();
    expect(api.startVkHandoff).not.toHaveBeenCalled();
    vi.mocked(api.claimVkHandoff).mockResolvedValue({ status: 'ok' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a sign-in that finished while the Mini App was reloading is collected on arrival', async () => {
    vi.mocked(api.claimVkHandoff).mockResolvedValueOnce({ status: 'ok' });
    const { refresh } = renderLogin();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.startVkHandoff).not.toHaveBeenCalled();
  });

  it('Telegram reloaded the Mini App right after the tap (browser not open yet): it keeps waiting for THAT sign-in', async () => {
    window.sessionStorage.setItem('zybrilka_vk_handoff_opened_at', String(Date.now()));
    vi.mocked(api.claimVkHandoff).mockResolvedValueOnce({ status: 'pending', started: false });
    renderLogin();
    expect(await screen.findByText('Ждём вход через VK ID')).toBeInTheDocument();
    expect(api.startVkHandoff).not.toHaveBeenCalled();
  });

  it('VK not configured on the server (503): the button is disabled with a clear note', async () => {
    vi.mocked(api.startVkHandoff).mockRejectedValue(
      new api.ApiError(503, { error: 'vk_not_configured' }),
    );
    renderLogin();
    expect(await screen.findByText('Вход через VK ID сейчас недоступен')).toBeInTheDocument();
    expect(await vkButton()).toBeDisabled();
  });
});
