import type { MainTabId, OverlayRoute, Route } from './navigation.js';
import type { SubjectModeId } from '../data/subjectContent.js';
import { EXAM_EDITIONS, type ExamEditionId } from '@zybrilka/shared';
import { libraryItem } from '../data/library/libraryData.js';
import { russianTheory } from '../data/theory/russianTheoryData.js';
import { mathTheorySpecs, SEO_MATH_EDITION } from './seoPages.js';

const subjectModeIds: readonly SubjectModeId[] = ['topics', 'byNumber', 'variants', 'favorites'];

/**
 * URL <-> Route mapping. The URL is the single source of truth for
 * which screen is showing (Section 5 of the routing rework) — every
 * addressable route below round-trips through here so refresh, direct
 * links, and Back/Forward all resolve to the same screen `navigate()`
 * would have produced.
 *
 * Not every `Route` is addressable: `task`/`result` need a real
 * `taskId` this demo data model can't restore from a bare URL, so those
 * two keep the
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
  rating: '/rating',
  level: '/level',
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
  miniGames: '/games',
  stressGame: '/games/stress',
  dictionaryGame: '/games/dictionary',
  onboarding: '/onboarding',
  landing: '/landing',
  telegramReturn: '/telegram-return',
};

const tabPaths: Record<string, string> = {
  home: '/',
  training: '/training',
  statistics: '/statistics',
  achievements: '/achievements',
};

/** Routes that never get a URL/history entry (see file header). */
function isUnaddressable(route: Route): boolean {
  return route.screen === 'task' || route.screen === 'result';
}

/** `/learning/session/:sessionId` prefix — see navigation.tsx's
 * `learningSession` route for why this one (unlike `task`/`result`)
 * must be addressable and refresh-safe. */
const learningSessionPathPrefix = '/learning/session/';
const variantAttemptPathPrefix = '/statistics/variants/';

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
    if (route.initialMode === 'byNumber' && route.initialTaskNumber) {
      params.set('n', String(route.initialTaskNumber));
    }
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return `/subjects/${slug}${query}`;
  }

  if (route.screen === 'profile') {
    return '/profile';
  }

  if (route.screen === 'library') {
    // An item has its own readable address (/materials/<id>); the subject
    // filter rides along only so «Все материалы» returns to the same list.
    const params = new URLSearchParams();
    if (route.subject) params.set('s', route.subject);
    const qs = params.toString();
    const base = route.section === 'strategies' ? '/strategies' : '/materials';
    const path = route.itemId ? `${base}/${route.itemId}` : base;
    return qs ? `${path}?${qs}` : path;
  }

  if (route.screen === 'theory') {
    // Readable addresses (docs/seo/SEO-REPORT.md): /theory/russian/9,
    // /theory/math, /theory/math/13 — the current numbering. Another
    // edition or a topic without a number keeps its query address.
    if (route.subject !== 'math' && route.taskNumber) {
      return `/theory/russian/${route.taskNumber}`;
    }
    if (
      route.subject === 'math' &&
      !route.topic &&
      (!route.edition || route.edition === SEO_MATH_EDITION)
    ) {
      return route.taskNumber ? `/theory/math/${route.taskNumber}` : '/theory/math';
    }
    const base = '/theory';
    const params = new URLSearchParams();
    if (route.subject === 'math') params.set('s', 'math');
    if (route.subject === 'math' && route.edition) params.set('ed', route.edition);
    if (route.subject === 'math' && route.topic) params.set('t', route.topic);
    else if (route.taskNumber) params.set('n', String(route.taskNumber));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  if (route.screen === 'learningSession') {
    return `${learningSessionPathPrefix}${route.sessionId}`;
  }

  if (route.screen === 'recommendations') {
    return route.subjectId
      ? `/learning/recommendations?s=${route.subjectId}`
      : '/learning/recommendations';
  }
  if (route.screen === 'learningPlan') return `/learning/plan?s=${route.subjectId}`;
  if (route.screen === 'skillAdvice') return `/learning/advice/${route.skillKey}`;
  if (route.screen === 'skillProgress') return `/learning/progress/${route.skillKey}`;

  if (route.screen === 'quizGame') {
    return `/games/${route.gameId}`;
  }
  if (route.screen === 'variantAttempt') {
    return `${variantAttemptPathPrefix}${route.sessionId}`;
  }

  if (route.screen === 'friendProfile') {
    return `/friends/${route.friendId}`;
  }

  const simple = simpleOverlayPaths[route.screen as OverlayRoute['screen']];
  return simple ?? null;
}

const simpleOverlayScreens = new Set(Object.keys(simpleOverlayPaths));

const legacyByNumberPath = '/training/by-number';

/** Paths of screens that were removed from the product. `routeFromPath`
 * already lands them on Home; this lets the router also correct the
 * address bar (see NavigationProvider) so an old bookmark or link does
 * not keep showing a URL of a page that no longer exists. */
const removedPaths: ReadonlySet<string> = new Set(['/about']);

/** A path that still works but has a newer address (the old standalone
 * "По номерам" page; query addresses of theory and library pages, e.g.
 * /theory?n=9 → /theory/russian/9) — the router rewrites the address bar.
 * Pass the query too (`pathname + search`). */
export function isLegacyPath(pathname: string): boolean {
  const path = (pathname.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  if (path === legacyByNumberPath) return true;
  if (pathname.includes('?') && /^\/(theory|materials|strategies)$/.test(path)) {
    return pathForRoute(routeFromPath(pathname)) !== pathname;
  }
  return false;
}

/** /theory/russian/9, /theory/math, /theory/math/13, /materials/<id>,
 * /strategies/<id> — only numbers and items that exist. */
function readableLearningRoute(path: string, params: URLSearchParams): Route | null {
  if (path === '/theory/math') return { screen: 'theory', section: 'rules', subject: 'math' };
  const theory = path.match(/^\/theory\/(russian|math)\/([1-9][0-9]?)$/);
  if (theory) {
    const n = Number(theory[2]);
    if (theory[1] === 'russian' && russianTheory.some((t) => t.taskNumber === n)) {
      return { screen: 'theory', section: 'rules', taskNumber: n };
    }
    if (theory[1] === 'math' && mathTheorySpecs.some((s) => s.number === n)) {
      return { screen: 'theory', section: 'rules', subject: 'math', taskNumber: n };
    }
    return null;
  }
  const item = path.match(/^\/(materials|strategies)\/([a-z0-9-]+)$/);
  if (item) {
    const found = libraryItem(item[2]!);
    if (!found || found.section !== item[1]) return null;
    const subject = params.get('s');
    return {
      screen: 'library',
      section: found.section,
      itemId: found.id,
      ...(subject === 'math' || subject === 'russian' || subject === 'general' ? { subject } : {}),
    };
  }
  return null;
}

export function isRemovedPath(pathname: string): boolean {
  const path = (pathname.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  return removedPaths.has(path);
}

/** Parses a pathname (optionally with a `?query` string attached) into
 * a Route, defaulting to Home for anything unrecognized rather than
 * erroring — a stale/typo'd/removed link should land the user
 * somewhere real, not a blank screen. */
function isExamEditionId(value: string): value is ExamEditionId {
  return EXAM_EDITIONS.some((e) => e.id === value);
}

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
    const n = Number(params.get('n'));
    const initialTaskNumber =
      initialMode === 'byNumber' && Number.isInteger(n) && n > 0 ? n : undefined;
    return {
      screen: 'subject',
      subjectId,
      from: 'subjectCatalog',
      collectionSlug,
      initialMode,
      ...(initialTaskNumber ? { initialTaskNumber } : {}),
    };
  }

  // "По номерам" used to be its own screen; old links land on the
  // subject page in that mode (math was that screen's default subject).
  if (path === legacyByNumberPath) {
    return {
      screen: 'subject',
      subjectId: 'math',
      from: 'subjectCatalog',
      initialMode: 'byNumber',
    };
  }

  if (path === '/profile') return { screen: 'profile' };

  const readable = readableLearningRoute(path, params);
  if (readable) return readable;

  if (path === '/strategies' || path === '/materials') {
    const subject = params.get('s');
    const id = params.get('id');
    const n = Number(params.get('n'));
    // Old «Полезные материалы» links (per-task lists and practice, the
    // math catalog) now live in the theory catalog: send them there.
    const legacyTheory =
      path === '/materials' &&
      ((Number.isInteger(n) && n > 0) || params.has('ed') || params.has('t'));
    if (!legacyTheory) {
      return {
        screen: 'library',
        section: path === '/strategies' ? 'strategies' : 'materials',
        ...(subject === 'math' || subject === 'russian' || subject === 'general'
          ? { subject }
          : {}),
        // Only an item of this section: a wrong one opens the list.
        ...(id && libraryItem(id)?.section === (path === '/strategies' ? 'strategies' : 'materials')
          ? { itemId: id }
          : {}),
      };
    }
  }

  if (path === '/theory' || path === '/materials') {
    const n = Number(params.get('n'));
    const math = params.get('s') === 'math';
    const ed = params.get('ed');
    const topic = params.get('t');
    return {
      screen: 'theory',
      section: 'rules',
      ...(Number.isInteger(n) && n > 0 ? { taskNumber: n } : {}),
      ...(math ? { subject: 'math' as const } : {}),
      // Only a known edition; anything else falls back to the current one.
      ...(math && ed && isExamEditionId(ed) ? { edition: ed } : {}),
      ...(math && topic && /^math\.[a-z-]+$/.test(topic) ? { topic } : {}),
    };
  }

  if (path === '/learning/recommendations') {
    const s = params.get('s');
    return {
      screen: 'recommendations',
      ...(s === 'math' || s === 'russian' ? { subjectId: s } : {}),
    };
  }
  if (path === '/learning/plan') {
    const s = params.get('s');
    return { screen: 'learningPlan', subjectId: s === 'russian' ? 'russian' : 'math' };
  }
  const skillPath = path.match(/^\/learning\/(advice|progress)\/((?:math|russian)\.[a-z0-9-]+)$/);
  if (skillPath) {
    return skillPath[1] === 'advice'
      ? { screen: 'skillAdvice', skillKey: skillPath[2]! }
      : { screen: 'skillProgress', skillKey: skillPath[2]! };
  }

  if (path.startsWith(learningSessionPathPrefix)) {
    const sessionId = path.slice(learningSessionPathPrefix.length);
    if (sessionId) return { screen: 'learningSession', sessionId };
  }

  const attemptMatch = path.match(/^\/statistics\/variants\/([0-9a-f-]{36})$/);
  if (attemptMatch) return { screen: 'variantAttempt', sessionId: attemptMatch[1]! };

  const quizMatch = path.match(/^\/games\/([a-z0-9-]+)$/);
  if (quizMatch && quizMatch[1] !== 'stress' && quizMatch[1] !== 'dictionary') return { screen: 'quizGame', gameId: quizMatch[1]! };

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
    screen === 'variantAttempt' ||
    screen === 'quizGame' ||
    simpleOverlayScreens.has(screen)
  );
}
