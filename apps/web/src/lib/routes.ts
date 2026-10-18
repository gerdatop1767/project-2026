import type { MainTabId, OverlayRoute, Route } from './navigation.js';
import type { SubjectModeId } from '../data/subjectContent.js';

const subjectModeIds: readonly SubjectModeId[] = ['topics', 'variants', 'favorites'];

/**
 * URL <-> Route mapping. The URL is the single source of truth for
 * which screen is showing (Section 5 of the routing rework) — every
 * addressable route below round-trips through here so refresh, direct
 * links, and Back/Forward all resolve to the same screen `navigate()`
 * would have produced.
 *
 * Not every `Route` is addressable: `menu` is a transient drawer (no
 * approved screenshot treats it as its own page — see DesktopMenu/
 * MobileMenu), and `task`/`result` need a real `taskId` this demo data
 * model can't restore from a bare URL, so those three keep the
 * pre-routing behavior (no history entry, no path) rather than
 * pretending to deep-link into content that doesn't exist yet.
 */

const subjectSlugs: Record<string, string> = {
  math: 'math',
  russian: 'russian',
  english: 'english',
  social: 'social-studies',
  informatics: 'informatics',
  physics: 'physics',
  chemistry: 'chemistry',
  biology: 'biology',
  history: 'history',
};

const slugToSubjectId: Record<string, string> = Object.fromEntries(
  Object.entries(subjectSlugs).map(([id, slug]) => [slug, id]),
);

/** Overlay screens with no params — a straight path <-> screen lookup. */
const simpleOverlayPaths: Partial<Record<OverlayRoute['screen'], string>> = {
  login: '/login',
  learningCenter: '/learning',
  subjectCatalog: '/subjects',
  mistakes: '/training/mistakes',
  trainingTopic: '/training/topic',
  trainingRandom: '/training/random',
  trainingVariants: '/training/variants',
  trainingByNumber: '/training/by-number',
  rating: '/rating',
  about: '/about',
  favorites: '/favorites',
  mockExams: '/mock-exams',
  topics: '/topics',
  friends: '/friends',
  settings: '/settings',
  help: '/help',
  faq: '/faq',
  privacy: '/privacy',
  terms: '/terms',
  notifications: '/notifications',
  onboarding: '/onboarding',
};

const tabPaths: Record<string, string> = {
  home: '/',
  training: '/training',
  statistics: '/statistics',
  achievements: '/achievements',
};

/** Routes that never get a URL/history entry (see file header). */
function isUnaddressable(route: Route): boolean {
  return route.screen === 'menu' || route.screen === 'task' || route.screen === 'result';
}

/** `/learning/session/:sessionId` prefix — see navigation.tsx's
 * `learningSession` route for why this one (unlike `task`/`result`)
 * must be addressable and refresh-safe. */
const learningSessionPathPrefix = '/learning/session/';

export function pathForRoute(route: Route): string | null {
  if (isUnaddressable(route)) return null;

  if (route.screen in tabPaths) {
    return tabPaths[route.screen]!;
  }

  if (route.screen === 'subject') {
    const slug = subjectSlugs[route.subjectId] ?? route.subjectId;
    const params = new URLSearchParams();
    if (route.collectionSlug) params.set('source', route.collectionSlug);
    if (route.initialMode) params.set('mode', route.initialMode);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return `/subjects/${slug}${query}`;
  }

  if (route.screen === 'profile') {
    return '/profile';
  }

  if (route.screen === 'learningSession') {
    return `${learningSessionPathPrefix}${route.sessionId}`;
  }

  if (route.screen === 'friendProfile') {
    return `/friends/${route.friendId}`;
  }

  const simple = simpleOverlayPaths[route.screen as OverlayRoute['screen']];
  return simple ?? null;
}

const simpleOverlayScreens = new Set(Object.keys(simpleOverlayPaths));

/** Parses a pathname (optionally with a `?query` string attached) into
 * a Route, defaulting to Home for anything unrecognized rather than
 * erroring — a stale/typo'd/removed link should land the user
 * somewhere real, not a blank screen. */
export function routeFromPath(pathname: string): Route {
  const [rawPath, search] = pathname.split('?');
  const path = (rawPath ?? '/').replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search ?? '');

  if (path === '/') return { screen: 'home' };

  for (const [tab, tabPath] of Object.entries(tabPaths)) {
    if (tab !== 'home' && path === tabPath) return { screen: tab as MainTabId };
  }

  const subjectMatch = path.match(/^\/subjects\/([a-z-]+)$/);
  if (subjectMatch) {
    const slug = subjectMatch[1]!;
    const subjectId = slugToSubjectId[slug] ?? slug;
    const collectionSlug = params.get('source') ?? undefined;
    const modeParam = params.get('mode');
    const initialMode = subjectModeIds.includes(modeParam as SubjectModeId)
      ? (modeParam as SubjectModeId)
      : undefined;
    return { screen: 'subject', subjectId, from: 'subjectCatalog', collectionSlug, initialMode };
  }

  if (path === '/profile') return { screen: 'profile' };

  if (path.startsWith(learningSessionPathPrefix)) {
    const sessionId = path.slice(learningSessionPathPrefix.length);
    if (sessionId) return { screen: 'learningSession', sessionId };
  }

  const friendMatch = path.match(/^\/friends\/([a-zA-Z0-9_-]+)$/);
  if (friendMatch) {
    return { screen: 'friendProfile', friendId: friendMatch[1]! };
  }

  for (const [screen, screenPath] of Object.entries(simpleOverlayPaths)) {
    if (path === screenPath) return { screen } as OverlayRoute;
  }

  return { screen: 'home' };
}

export function isAddressableScreen(screen: string): boolean {
  return (
    screen in tabPaths ||
    screen === 'subject' ||
    screen === 'profile' ||
    screen === 'friendProfile' ||
    screen === 'learningSession' ||
    simpleOverlayScreens.has(screen)
  );
}
