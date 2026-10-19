import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, trainingByNumberRouteFor, useNavigation } from './navigation.js';

function Probe() {
  const { tab, overlay, navigate, back } = useNavigation();
  return (
    <div>
      <p data-testid="tab">{tab}</p>
      <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>
      <button onClick={() => navigate({ screen: 'subjectCatalog' })}>go-subjects</button>
      <button
        onClick={() => navigate({ screen: 'subject', subjectId: 'math', from: 'subjectCatalog' })}
      >
        go-math
      </button>
      <button onClick={() => navigate({ screen: 'menu' })}>go-menu</button>
      <button onClick={() => navigate({ screen: 'statistics' })}>go-statistics</button>
      <button onClick={back}>back</button>
    </div>
  );
}

describe('NavigationProvider — URL is the source of truth', () => {
  it('reads the initial route from window.location (refresh/direct-link)', () => {
    window.history.replaceState(null, '', '/help');
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    expect(screen.getByTestId('overlay')).toHaveTextContent('help');
  });

  it('falls back to Home for an unknown path', () => {
    window.history.replaceState(null, '', '/this-page-does-not-exist');
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('navigate() pushes a real history entry for addressable routes', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('go-subjects'));
    expect(window.location.pathname).toBe('/subjects');
    await user.click(screen.getByText('go-math'));
    expect(window.location.pathname).toBe('/subjects/math');
  });

  it('navigate() to an unaddressable route (menu) does not change the URL', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    const before = window.location.pathname;
    await user.click(screen.getByText('go-menu'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('menu');
    expect(window.location.pathname).toBe(before);
  });

  it('back() pops real history for an addressable overlay', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('go-subjects'));
    expect(window.location.pathname).toBe('/subjects');
    await user.click(screen.getByText('back'));
    // jsdom's history.back() dispatches popstate synchronously via act.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('a browser Back/Forward (popstate) re-syncs tab/overlay state', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('go-statistics'));
    expect(screen.getByTestId('tab')).toHaveTextContent('statistics');

    // Simulate the browser popping back to '/' without going through navigate().
    await act(async () => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
  });
});

/**
 * "К списку заданий №N" (UX bugfix round 3) — the ONE shared way every
 * Task/Result screen (mobile and desktop alike) builds this route, so
 * neither platform invents its own navigation mechanism.
 */
describe('trainingByNumberRouteFor', () => {
  it('opens the subject page in "По номерам" with the real subjectId and number pre-selected', () => {
    expect(trainingByNumberRouteFor('math', 13)).toEqual({
      screen: 'subject',
      subjectId: 'math',
      initialMode: 'byNumber',
      initialTaskNumber: 13,
    });
  });

  it('is deterministic for different subjects/numbers, never hardcoded to one', () => {
    expect(trainingByNumberRouteFor('russian', 7)).toEqual({
      screen: 'subject',
      subjectId: 'russian',
      initialMode: 'byNumber',
      initialTaskNumber: 7,
    });
  });
});

/**
 * Closing a screen must never throw the user out of the app. The bug this
 * guards: the sign-in "×" called `history.back()`, which — when the screen
 * was the first entry of the visit (opened by URL, a refresh, an OAuth
 * return) — left the site (about:blank) or did nothing, and when it sat on
 * top of a private URL it bounced straight back into the same redirect.
 */
describe('NavigationProvider — history marker, replace and safe back/leave', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  function Controls() {
    const { tab, overlay, navigate, back, leave } = useNavigation();
    return (
      <div>
        <p data-testid="tab">{tab}</p>
        <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>
        <button onClick={() => navigate({ screen: 'subjectCatalog' })}>go-subjects</button>
        <button onClick={() => navigate({ screen: 'subject', subjectId: 'math' })}>go-math</button>
        <button onClick={() => navigate({ screen: 'login' })}>open-login</button>
        <button onClick={() => navigate({ screen: 'login' }, { replace: true })}>
          replace-login
        </button>
        <button onClick={back}>back</button>
        <button onClick={() => leave({ screen: 'home' })}>leave-home</button>
      </div>
    );
  }

  const renderControls = () =>
    render(
      <NavigationProvider>
        <Controls />
      </NavigationProvider>,
    );
  const markerIndex = () =>
    (window.history.state as { zybrilka?: { index?: number } } | null)?.zybrilka?.index;

  it('marks the first entry of a visit as index 0 and counts every push', async () => {
    const user = userEvent.setup();
    renderControls();
    expect(markerIndex()).toBe(0);
    await user.click(screen.getByText('go-subjects'));
    expect(markerIndex()).toBe(1);
    await user.click(screen.getByText('go-math'));
    expect(markerIndex()).toBe(2);
  });

  it('navigate(…, { replace: true }) adds no history entry and keeps the index', async () => {
    const user = userEvent.setup();
    renderControls();
    const length = window.history.length;
    await user.click(screen.getByText('replace-login'));
    expect(window.location.pathname).toBe('/login');
    expect(window.history.length).toBe(length);
    expect(markerIndex()).toBe(0);
    expect(screen.getByTestId('overlay')).toHaveTextContent('login');
  });

  it('back() on the first entry of a visit does NOT call history.back — it returns to the tab in place', async () => {
    window.history.replaceState(null, '', '/login');
    const back = vi.spyOn(window.history, 'back');
    const user = userEvent.setup();
    renderControls();
    expect(screen.getByTestId('overlay')).toHaveTextContent('login');
    const length = window.history.length;

    await user.click(screen.getByText('back'));
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
    expect(window.history.length).toBe(length);
    back.mockRestore();
  });

  it('back() with an in-app entry behind it is a real browser Back', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const user = userEvent.setup();
    renderControls();
    await user.click(screen.getByText('open-login'));
    expect(markerIndex()).toBe(1);
    await user.click(screen.getByText('back'));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it('leave(fallback) ends on the fallback when there is no history of the app to return to', async () => {
    // Opened by URL on a private tab, sign-in on top of it (replace): `back()`
    // would return to that tab; `leave(home)` is what the sign-in × uses.
    window.history.replaceState(null, '', '/statistics');
    const user = userEvent.setup();
    renderControls();
    expect(screen.getByTestId('tab')).toHaveTextContent('statistics');
    await user.click(screen.getByText('replace-login'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('login');

    await user.click(screen.getByText('leave-home'));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('keeps the #hash and the query when it marks the first entry (Telegram launch data lives in the hash)', () => {
    window.history.replaceState(null, '', '/help?x=1#tgWebAppData=abc&tgWebAppVersion=8');
    renderControls();
    expect(window.location.pathname).toBe('/help');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#tgWebAppData=abc&tgWebAppVersion=8');
    expect(markerIndex()).toBe(0);
  });

  it('corrects the address of a removed page (/about) to the site root on load', () => {
    window.history.replaceState(null, '', '/about');
    renderControls();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });
});
