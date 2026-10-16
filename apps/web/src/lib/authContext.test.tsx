import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './authContext.js';
import * as api from './api.js';
import type * as ApiModule from './api.js';
import { makeAuthUser } from './authTestUtils.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

let latest: ReturnType<typeof useAuth>;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    latest = auth;
  });
  latest ??= auth;
  return <p>{auth.user === undefined ? 'pending' : (auth.user?.firstName ?? 'signed-out')}</p>;
}

function renderProvider(onSignedOut = vi.fn()) {
  render(
    <AuthProvider onSignedOut={onSignedOut}>
      <Probe />
    </AuthProvider>,
  );
  return onSignedOut;
}

afterEach(() => vi.resetAllMocks());

describe('AuthProvider', () => {
  it('starts "not checked yet" and then reflects the server user', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser({ firstName: 'Анна' }) });
    renderProvider();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(await screen.findByText('Анна')).toBeInTheDocument();
  });

  it('treats an unreachable backend as signed out, not stuck on loading', async () => {
    vi.mocked(api.getCurrentUser).mockRejectedValue(new Error('offline'));
    renderProvider();
    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });

  it('logout ends the server session first, then clears state and runs the sign-out redirect', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser() });
    vi.mocked(api.logout).mockResolvedValue(undefined);
    const onSignedOut = renderProvider();
    await screen.findByText('Иван');

    await act(async () => {
      await latest.logout();
    });
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('logout that fails on the server keeps the user signed in and does NOT redirect', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser() });
    vi.mocked(api.logout).mockRejectedValue(new Error('network'));
    const onSignedOut = renderProvider();
    await screen.findByText('Иван');

    await act(async () => {
      await expect(latest.logout()).rejects.toThrow('network');
    });
    expect(screen.getByText('Иван')).toBeInTheDocument();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('a 401 from any private endpoint (session expired/deleted) drops the signed-in state', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser() });
    renderProvider();
    await screen.findByText('Иван');

    // Real apiFetch path: a private endpoint answering 401 notifies listeners.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
    );
    const real = await vi.importActual<typeof ApiModule>('./api.js');
    await expect(real.getProgressSummary()).rejects.toBeInstanceOf(real.ApiError);
    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('refresh() re-reads /auth/me (e.g. after onboarding completes)', async () => {
    vi.mocked(api.getCurrentUser)
      .mockResolvedValueOnce({ user: makeAuthUser({ onboardingCompleted: false }) })
      .mockResolvedValueOnce({
        user: makeAuthUser({ firstName: 'Новый', onboardingCompleted: true }),
      });
    renderProvider();
    await screen.findByText('Иван');
    await act(async () => {
      await latest.refresh();
    });
    expect(screen.getByText('Новый')).toBeInTheDocument();
    expect(latest.user?.onboardingCompleted).toBe(true);
  });
});

describe('api 401 handling', () => {
  it('does not treat a 401 from /auth/* as "session ended" (a failed sign-in step is not a sign-out)', async () => {
    const real = await vi.importActual<typeof ApiModule>('./api.js');
    const listener = vi.fn();
    const off = real.onUnauthorized(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(real.getCurrentUser()).rejects.toBeInstanceOf(real.ApiError);
    expect(listener).not.toHaveBeenCalled();
    off();
    vi.unstubAllGlobals();
  });
});
