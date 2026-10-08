import { describe, expect, it } from 'vitest';
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
  it('builds a trainingByNumber route with the real subjectId and initialTaskNumber', () => {
    expect(trainingByNumberRouteFor('math', 13)).toEqual({
      screen: 'trainingByNumber',
      subjectId: 'math',
      initialTaskNumber: 13,
      from: { screen: 'subject', subjectId: 'math' },
    });
  });

  it('is deterministic for different subjects/numbers, never hardcoded to one', () => {
    expect(trainingByNumberRouteFor('russian', 7)).toEqual({
      screen: 'trainingByNumber',
      subjectId: 'russian',
      initialTaskNumber: 7,
      from: { screen: 'subject', subjectId: 'russian' },
    });
  });
});
