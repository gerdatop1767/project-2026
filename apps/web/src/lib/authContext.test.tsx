import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './authContext.js';
import * as api from './api.js';
import type * as ApiModule from './api.js';
import { makeAuthUser } from './authTestUtils.js';
import { getCanvasState, setCanvasState } from './canvasSessionStore.js';
import { initialCanvasState } from './canvasEngine.js';
import { resetFavoritesCacheForTests, useFavorite } from './useFavorite.js';
import { LearningSessionProvider, useLearningSessionContext } from './learningSessionContext.js';

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  listFavoriteTaskIds: vi.fn(),
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
  it('needsSignInMethod follows /auth/me and never sticks to another account', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      user: makeAuthUser({ firstName: 'Анна' }),
      needsSignInMethod: true,
    });
    renderProvider();
    await screen.findByText('Анна');
    expect(latest.needsSignInMethod).toBe(true);

    // After connecting VK the server no longer sends the flag.
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser({ firstName: 'Анна' }) });
    await act(() => latest.refresh());
    expect(latest.needsSignInMethod).toBe(false);
  });

  it('needsSignInMethod is false for a regular account', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: makeAuthUser({ firstName: 'Олег' }) });
    renderProvider();
    await screen.findByText('Олег');
    expect(latest.needsSignInMethod).toBe(false);
  });

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

describe('private caches follow the signed-in identity', () => {
  const USER_A = makeAuthUser({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Анна' });
  const USER_B = makeAuthUser({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Борис' });
  const drawnCanvas = () =>
    ({ ...initialCanvasState(), strokes: [{ id: 's', points: [] }] }) as never;
  const hasDrawing = (taskId: string) =>
    JSON.stringify(getCanvasState(taskId)) !== JSON.stringify(initialCanvasState());

  beforeEach(() => {
    resetFavoritesCacheForTests();
  });
  afterEach(() => {
    setCanvasState('task-1', initialCanvasState());
  });

  it('keeps the canvas when the SAME user is re-checked (refresh, onboarding finished)', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: USER_A });
    renderProvider();
    await screen.findByText('Анна');
    setCanvasState('task-1', drawnCanvas());

    await act(async () => {
      await latest.refresh();
    });
    expect(hasDrawing('task-1')).toBe(true);
  });

  it('wipes the canvas, favorites and learning session when the session is lost (401) — before anyone else can sign in', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: USER_A });
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: ['fav-of-A'] });
    function Both() {
      const fav = useFavorite('fav-of-A');
      const { session, setSession } = useLearningSessionContext();
      return (
        <>
          <p>fav:{String(fav.isFavorite)}</p>
          <p>session:{session ? session.sessionId : 'none'}</p>
          <button
            onClick={() =>
              setSession({
                status: 'active',
                sessionId: 'A-session',
                subjectId: 'math',
                currentTaskId: 't',
                currentTaskNumber: 1,
                position: 1,
                total: 5,
              })
            }
          >
            start
          </button>
        </>
      );
    }
    render(
      <AuthProvider onSignedOut={vi.fn()}>
        <LearningSessionProvider>
          <Probe />
          <Both />
        </LearningSessionProvider>
      </AuthProvider>,
    );
    await screen.findByText('fav:true');
    act(() => screen.getByText('start').click());
    expect(screen.getByText('session:A-session')).toBeInTheDocument();
    setCanvasState('task-1', drawnCanvas());

    // Session ends behind our back.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const real = await vi.importActual<typeof ApiModule>('./api.js');
    await expect(real.getProgressSummary()).rejects.toBeInstanceOf(real.ApiError);
    vi.unstubAllGlobals();

    await waitFor(() => expect(screen.getByText('session:none')).toBeInTheDocument());
    expect(hasDrawing('task-1')).toBe(false);

    // The next account must get a fresh favorites fetch, not A's cached set.
    vi.mocked(api.listFavoriteTaskIds).mockClear();
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [] });
    const { result } = renderHook(() => useFavorite('fav-of-A'));
    await waitFor(() => expect(result.current.isFavorite).toBe(false));
    expect(api.listFavoriteTaskIds).toHaveBeenCalledTimes(1);
  });

  it("user A -> user B in the same tab: B never sees A's drawing or favorites", async () => {
    vi.mocked(api.getCurrentUser)
      .mockResolvedValueOnce({ user: USER_A })
      .mockResolvedValueOnce({ user: USER_B });
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValueOnce({ taskIds: ['t-fav'] });
    renderProvider();
    await screen.findByText('Анна');
    const first = renderHook(() => useFavorite('t-fav'));
    await waitFor(() => expect(first.result.current.isFavorite).toBe(true));
    setCanvasState('task-1', drawnCanvas());

    await act(async () => {
      await latest.refresh();
    });
    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(hasDrawing('task-1')).toBe(false);

    vi.mocked(api.listFavoriteTaskIds).mockResolvedValueOnce({ taskIds: [] });
    const second = renderHook(() => useFavorite('t-fav'));
    await waitFor(() => expect(second.result.current.isFavorite).toBe(false));
  });

  it('real logout clears the caches too', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: USER_A });
    vi.mocked(api.logout).mockResolvedValue(undefined);
    renderProvider();
    await screen.findByText('Анна');
    setCanvasState('task-1', drawnCanvas());
    await act(async () => {
      await latest.logout();
    });
    expect(hasDrawing('task-1')).toBe(false);
  });

  it("a FAILED logout (server unreachable) keeps the session AND the user's data", async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: USER_A });
    vi.mocked(api.logout).mockRejectedValue(new Error('network'));
    renderProvider();
    await screen.findByText('Анна');
    setCanvasState('task-1', drawnCanvas());
    await act(async () => {
      await expect(latest.logout()).rejects.toThrow();
    });
    expect(hasDrawing('task-1')).toBe(true);
  });

  it('the very first successful check (nobody signed in before) clears nothing', async () => {
    setCanvasState('task-1', drawnCanvas());
    vi.mocked(api.getCurrentUser).mockResolvedValue({ user: USER_A });
    renderProvider();
    await screen.findByText('Анна');
    expect(hasDrawing('task-1')).toBe(true);
  });
});
