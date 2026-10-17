import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from './authContext.js';
import * as api from './api.js';
import type * as ApiModule from './api.js';
import * as miniApp from './telegramMiniApp.js';
import { makeAuthUser } from './authTestUtils.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getCurrentUser: vi.fn(),
  loginWithTelegram: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('./telegramMiniApp.js', () => ({
  getTelegramInitData: vi.fn(() => null),
  prepareTelegramApp: vi.fn(),
  isTelegramMiniApp: vi.fn(() => false),
}));

let latest: ReturnType<typeof useAuth>;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    latest = auth;
  });
  latest ??= auth;
  return (
    <p>
      {auth.user === undefined ? 'pending' : (auth.user?.displayName ?? 'signed-out')}|
      {auth.telegramError ?? 'no-error'}
    </p>
  );
}

function renderProvider() {
  render(
    <AuthProvider onSignedOut={vi.fn()}>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.resetAllMocks());

describe('AuthProvider — Telegram Mini App sign-in', () => {
  it('outside Telegram nothing is attempted', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue(null);
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: null });
    renderProvider();
    expect(await screen.findByText('signed-out|no-error')).toBeInTheDocument();
    expect(api.loginWithTelegram).not.toHaveBeenCalled();
  });

  it('inside Telegram with no session: sends the raw initData and signs in', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue('query_id=A&hash=h');
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: null });
    vi.mocked(api.loginWithTelegram).mockResolvedValue({
      user: makeAuthUser({ firstName: 'Тим', lastName: null }),
      created: true,
    });
    renderProvider();
    expect(await screen.findByText('Тим|no-error')).toBeInTheDocument();
    expect(api.loginWithTelegram).toHaveBeenCalledWith('query_id=A&hash=h');
  });

  it('an existing session wins: Telegram sign-in is not attempted', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue('query_id=A&hash=h');
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      user: makeAuthUser({ firstName: 'Анна', lastName: null }),
    });
    renderProvider();
    expect(await screen.findByText('Анна|no-error')).toBeInTheDocument();
    expect(api.loginWithTelegram).not.toHaveBeenCalled();
  });

  it('a rejected launch leaves the user signed out and exposes the server code', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue('x');
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: null });
    vi.mocked(api.loginWithTelegram).mockRejectedValue(
      new api.ApiError(401, { error: 'telegram_data_expired' }),
    );
    renderProvider();
    expect(await screen.findByText('signed-out|telegram_data_expired')).toBeInTheDocument();
  });

  it('after an explicit sign-out inside Telegram it does not sign straight back in', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue('x');
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser() });
    vi.mocked(api.logout).mockResolvedValue(undefined);
    renderProvider();
    await screen.findByText('Иван Петров|no-error');
    await act(async () => {
      await latest.logout();
    });
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: null });
    await act(async () => {
      await latest.refresh();
    });
    expect(api.loginWithTelegram).not.toHaveBeenCalled();
  });

  it('updateUser replaces the user of the same account, and ignores another account', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser() });
    renderProvider();
    await screen.findByText('Иван Петров|no-error');
    act(() => latest.updateUser(makeAuthUser({ customName: 'Новый ник' })));
    expect(await screen.findByText('Новый ник|no-error')).toBeInTheDocument();
    act(() => latest.updateUser(makeAuthUser({ id: 'other-user', customName: 'Чужой' })));
    expect(screen.queryByText('Чужой|no-error')).not.toBeInTheDocument();
  });
});
