import { describe, expect, it } from 'vitest';
import { isLegacyPath, isRemovedPath, pathForRoute, routeFromPath } from './routes.js';
import type { Route } from './navigation.js';

describe('pathForRoute', () => {
  it('maps tabs to their paths', () => {
    expect(pathForRoute({ screen: 'home' })).toBe('/');
    expect(pathForRoute({ screen: 'training' })).toBe('/training');
    expect(pathForRoute({ screen: 'statistics' })).toBe('/statistics');
    expect(pathForRoute({ screen: 'achievements' })).toBe('/achievements');
  });

  it('maps subjects to slugged paths, including the social-studies exception', () => {
    expect(pathForRoute({ screen: 'subject', subjectId: 'math' })).toBe('/subjects/math');
    expect(pathForRoute({ screen: 'subject', subjectId: 'social' })).toBe(
      '/subjects/social-studies',
    );
  });

  it('appends ?source= only when a collectionSlug is set', () => {
    expect(pathForRoute({ screen: 'subject', subjectId: 'math' })).toBe('/subjects/math');
    expect(
      pathForRoute({ screen: 'subject', subjectId: 'math', collectionSlug: 'ege-2026-yashchenko' }),
    ).toBe('/subjects/math?source=ege-2026-yashchenko');
  });

  it('maps simple overlays to their paths', () => {
    expect(pathForRoute({ screen: 'subjectCatalog' })).toBe('/subjects');
    expect(pathForRoute({ screen: 'profile' })).toBe('/profile');
    expect(pathForRoute({ screen: 'help' })).toBe('/help');
    expect(pathForRoute({ screen: 'rating' })).toBe('/rating');
    expect(pathForRoute({ screen: 'mistakes' })).toBe('/training/mistakes');
  });

  it('returns null for routes with no URL (menu/task/result)', () => {
    expect(pathForRoute({ screen: 'menu' })).toBeNull();
    expect(
      pathForRoute({ screen: 'task', subjectId: 'math', taskNumber: 1, taskId: 't1' }),
    ).toBeNull();
    expect(
      pathForRoute({
        screen: 'result',
        subjectId: 'math',
        taskNumber: 1,
        taskId: 't1',
        correct: true,
        userAnswer: '1',
      }),
    ).toBeNull();
  });
});

describe('routeFromPath', () => {
  it('round-trips every addressable route through pathForRoute', () => {
    const routes: Route[] = [
      { screen: 'home' },
      { screen: 'training' },
      { screen: 'statistics' },
      { screen: 'achievements' },
      { screen: 'subjectCatalog' },
      { screen: 'subject', subjectId: 'math' },
      { screen: 'subject', subjectId: 'social' },
      { screen: 'mistakes' },
      { screen: 'rating' },
      { screen: 'profile' },
      { screen: 'help' },
    ];
    for (const route of routes) {
      const path = pathForRoute(route);
      expect(path).not.toBeNull();
      expect(routeFromPath(path!)).toEqual(
        route.screen === 'subject' ? { ...route, from: 'subjectCatalog' } : route,
      );
    }
  });

  it('falls back to Home for an unknown path', () => {
    expect(routeFromPath('/this-does-not-exist')).toEqual({ screen: 'home' });
  });

  it('the removed /about page resolves to Home and is recognised as a removed path', () => {
    expect(routeFromPath('/about')).toEqual({ screen: 'home' });
    expect(routeFromPath('/about/')).toEqual({ screen: 'home' });
    expect(isRemovedPath('/about')).toBe(true);
    expect(isRemovedPath('/about/')).toBe(true);
    expect(isRemovedPath('/about?x=1')).toBe(true);
    // Only that exact page: nothing that merely starts with it.
    expect(isRemovedPath('/about-us')).toBe(false);
    expect(isRemovedPath('/help')).toBe(false);
    expect(isRemovedPath('/')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(routeFromPath('/help/')).toEqual({ screen: 'help' });
  });

  it('round-trips a subject route carrying a collectionSlug through ?source=', () => {
    const route: Route = {
      screen: 'subject',
      subjectId: 'math',
      collectionSlug: 'ege-2026-yashchenko',
    };
    const path = pathForRoute(route);
    expect(routeFromPath(path!)).toEqual({ ...route, from: 'subjectCatalog' });
  });

  it('parses no collectionSlug when ?source= is absent', () => {
    expect(routeFromPath('/subjects/math')).toEqual({
      screen: 'subject',
      subjectId: 'math',
      from: 'subjectCatalog',
    });
  });
});

describe('По номерам — a mode of the subject page', () => {
  it('round-trips mode and the pre-selected number through the URL', () => {
    const route: Route = {
      screen: 'subject',
      subjectId: 'math',
      initialMode: 'byNumber',
      initialTaskNumber: 13,
    };
    const path = pathForRoute(route)!;
    expect(path).toBe('/subjects/math?mode=byNumber&n=13');
    expect(routeFromPath(path)).toEqual({ ...route, from: 'subjectCatalog' });
  });

  it('ignores a bad number', () => {
    expect(routeFromPath('/subjects/math?mode=byNumber&n=abc')).not.toHaveProperty(
      'initialTaskNumber',
    );
  });

  it('old /training/by-number links land on the subject page in that mode', () => {
    expect(isLegacyPath('/training/by-number')).toBe(true);
    expect(routeFromPath('/training/by-number')).toEqual({
      screen: 'subject',
      subjectId: 'math',
      from: 'subjectCatalog',
      initialMode: 'byNumber',
    });
  });
});
