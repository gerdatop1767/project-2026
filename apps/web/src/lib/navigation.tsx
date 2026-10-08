import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { pathForRoute, routeFromPath } from './routes.js';
import type { SubjectModeId } from '../data/subjectContent.js';

/**
 * The persistent tabs behind the bottom nav (mobile) / sidebar
 * (desktop) — S1 Block 6, approved design. The screenshots show a
 * couple of different labels for slot 2/4 across mocks (Учёба vs
 * Тренировка, Достижения vs Ошибки vs Рейтинг); a real nav needs one
 * fixed set, so this uses the pattern that recurs across the most
 * screens. Мои ошибки / Рейтинг / О проекте stay reachable from Home
 * and the Menu overlay rather than living in the tab bar itself.
 * Профиль is an overlay (see `OverlayRoute`), not a tab — it opens
 * from Menu on top of whichever tab is underneath, the same as every
 * other Menu destination, so BackRow returns there correctly instead
 * of always landing on Home.
 */
export type MainTabId = 'home' | 'training' | 'statistics' | 'achievements';

export const mainTabIds: readonly MainTabId[] = ['home', 'training', 'statistics', 'achievements'];

/**
 * Full-screen overlays reached from a tab. Task/Result hide the tab
 * chrome entirely (mobile bottom nav / desktop sidebar) so the task
 * gets full screen real estate, matching the approved screenshots.
 */
export type OverlayRoute =
  | { screen: 'onboarding' }
  | { screen: 'learningCenter' }
  | { screen: 'subjectCatalog' }
  | {
      screen: 'subject';
      subjectId: string;
      /** Which screen opened this subject page, so BackRow can return
       * there directly (e.g. "Предметы → Математика → назад →
       * Предметы") instead of falling back to the underlying tab —
       * this router has no general back-stack, so the one drill-down
       * that needs it carries its own parent explicitly. */
      from?: 'subjectCatalog' | 'learningCenter';
      /** The collection slug selected in the "Источник" picker (e.g.
       * "ege-2026-yashchenko"), or absent for "Общий банк" (no
       * filter). Carried here — not component-local state — so it
       * survives navigating away to a task and back: this is the same
       * pattern subjectId/taskNumber/taskId already use to cross a
       * screen unmount, never a value a component would lose. */
      collectionSlug?: string;
      /** Opens the Subject page straight into this mode (e.g. `'topics'`
       * when returning from Result's "К списку заданий") instead of the
       * default "Темы" tab — absent means "let the page pick its own
       * default", same as before this existed. */
      initialMode?: SubjectModeId;
    }
  | {
      screen: 'task';
      subjectId: string;
      taskNumber: number;
      taskId: string;
      collectionSlug?: string;
      /** A specific variant's id, when already known (e.g. picked
       * explicitly in Training's "Вариант" mode) — lets the task
       * navigation hook skip re-resolving it from collectionSlug+taskId
       * on every screen. Absent just means "resolve it lazily"; it is
       * NOT required for source/variant isolation, which collectionSlug
       * alone already provides. */
      variantId?: string;
      /** A user-assembled task list (Subject → Варианты → "Собери
       * собственный вариант") that has no real `variants` row of its
       * own — the exact task numbers the user picked, in that order,
       * each already resolved to a real task id. When present, this
       * *is* the ordered context (useTaskNavigation uses it directly,
       * never re-resolving from collectionSlug/variantId), so the
       * number strip and prev/next show exactly this set — never
       * `taskNumber ± 1` and never the full canonical variant's 1..19
       * when the user picked a subset. Carried forward on every
       * `goTo()` the same way collectionSlug/variantId are. */
      customOrderedTasks?: readonly { taskId: string; taskNumber: number }[];
      /** Where the back arrow should go — this router has no general
       * overlay-to-overlay back-stack, so an overlay opened from
       * another overlay (Subject/Variants/Mistakes → Task) needs its
       * own explicit return route or `back()` collapses straight past
       * it to the underlying tab (audit Block 3). Absent means "no
       * known parent overlay", so the back arrow falls back to the old
       * `back()` behavior — e.g. the "Похожие задания" cross-source
       * sibling switch, which already intentionally drops context. */
      returnTo?: Route;
    }
  | {
      screen: 'result';
      subjectId: string;
      taskNumber: number;
      taskId: string;
      correct: boolean;
      /** The user's actual submitted answer — Result must show what
       * they really typed, never a placeholder. */
      userAnswer: string;
      collectionSlug?: string;
      variantId?: string;
      /** Same purpose as `task.customOrderedTasks` above — a custom
       * variant's ordering survives into Result the same way a real
       * variant's does. */
      customOrderedTasks?: readonly { taskId: string; taskNumber: number }[];
      /** Same purpose as `task.returnTo` above — Result's back arrow
       * needs the same parent-overlay context Task had. */
      returnTo?: Route;
      /** The real elapsed solving time already submitted with this
       * attempt (see `useSolvingTimer`) — absent when the timer was
       * never started. Carried the same way `userAnswer` is, purely for
       * Result's own display; never re-sent to the backend. */
      timeSpentMs?: number;
    }
  | { screen: 'mistakes' }
  /**
   * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — the one addressable
   * entry point for a real backend learning session
   * (`apps/api/.../learningSession`). Deliberately addressable (unlike
   * `task`/`result`, see their comment below): a page refresh here
   * must recover the session from the server via
   * `GET /me/learning/sessions/:sessionId`, never silently create a
   * new one or lose the server-authoritative position. Once resolved,
   * this screen hands off into the normal `task`/`result` overlays
   * (via `LearningSessionProvider`, not a new route field on them) for
   * the actual solving UI — see `lib/learningSessionContext.tsx`.
   */
  | { screen: 'learningSession'; sessionId: string }
  /** Addressable placeholders for training modes not yet built as
   * their own screens — routing needs a real page for each one so
   * refresh/direct-link/Back-Forward work, even though the mode
   * itself still renders the plain WIP placeholder. */
  | { screen: 'trainingTopic' }
  | { screen: 'trainingRandom' }
  | { screen: 'trainingVariants' }
  /** The dedicated "Задания по номерам" screen (real, not a WIP
   * placeholder) — multi-select task numbers, two *independent*
   * toggles per number (🎲 Случайное / 🔄 Только нерешённые — both can
   * be on at once), and an optional shuffle of solving order. See
   * TrainingByNumber.tsx. Reachable both from Training's mode grid and
   * from Subject's own "Задания по номерам" tab — `from` carries
   * whichever one it was, and an optional `subjectId`/`collectionSlug`
   * seed the screen's own pickers, matching the `subject` overlay's
   * own `from`/`collectionSlug` pattern. */
  | {
      screen: 'trainingByNumber';
      from?: Route;
      subjectId?: string;
      collectionSlug?: string;
      /** Pre-selects this one number on entry (e.g. "Другие задания
       * №13"'s "К списку заданий №13" button) — the user can freely
       * add/remove numbers afterward, same chips as any other entry.
       * An out-of-range number for the resolved subject is silently
       * ignored (TrainingByNumber's own existing out-of-range rule —
       * see `selectSubject`), never a crash or a fake selection. */
      initialTaskNumber?: number;
    }
  | { screen: 'rating' }
  | { screen: 'about' }
  | { screen: 'menu' }
  | { screen: 'favorites' }
  | { screen: 'mockExams' }
  | { screen: 'topics' }
  | { screen: 'friends' }
  | { screen: 'friendProfile'; friendId: string }
  | { screen: 'settings' }
  | { screen: 'help' }
  | { screen: 'notifications' }
  | {
      screen: 'profile';
      /** The full previous route (tab or overlay), so BackRow can
       * restore it exactly — Menu replaces whatever overlay was
       * showing when it opens Профиль (this router has no general
       * back-stack), so without this the "previous screen" is gone
       * before BackRow ever runs. */
      from?: Route;
    };

export type Route = { screen: MainTabId } | OverlayRoute;

const routeLabels: Partial<Record<Route['screen'], string>> = {
  home: 'Главная',
  training: 'Тренировка',
  statistics: 'Статистика',
  achievements: 'Достижения',
  learningCenter: 'Учебный центр',
  learningSession: 'Тренировка',
  subjectCatalog: 'Предметы',
  mistakes: 'Мои ошибки',
  trainingByNumber: 'По номерам',
  rating: 'Рейтинг',
  about: 'О проекте',
};

/** A human label for any route, used by BackRow to name where it's
 * going back to. Falls back to "Главная" for routes with no fixed
 * name (task/result/subject carry their own context instead). */
export function getRouteLabel(route: Route): string {
  return routeLabels[route.screen] ?? 'Главная';
}

/**
 * "К списку заданий №N" (Similar Tasks' `OtherVariantsSection`/
 * `OtherVariantsSectionDesktop`, both mobile and desktop) — the ONE
 * shared way every Task/Result screen builds this route, so neither
 * platform invents its own. Pre-selects `taskNumber` on
 * TrainingByNumber (see its `initialTaskNumber` doc comment) without
 * starting training; `from` matches the existing cross-source
 * "Другие задания" convention (`handleSelectVariant` elsewhere in
 * these same screens) of returning to the subject page, since this
 * leaves the current task's source/session context behind.
 */
export function trainingByNumberRouteFor(subjectId: string, taskNumber: number): Route {
  return {
    screen: 'trainingByNumber',
    subjectId,
    initialTaskNumber: taskNumber,
    from: { screen: 'subject', subjectId },
  };
}

interface NavigationContextValue {
  /** The currently selected tab (persists under an open overlay). */
  tab: MainTabId;
  /** The active overlay, or null when a tab screen is showing. */
  overlay: OverlayRoute | null;
  navigate: (route: Route) => void;
  /** Closes the current overlay, returning to its underlying tab. */
  back: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

function initialRoute(): Route {
  return typeof window === 'undefined'
    ? { screen: 'home' }
    : routeFromPath(window.location.pathname + window.location.search);
}

/**
 * Lightweight typed navigation: a router this small doesn't need a
 * routing library. Tabs are mutually exclusive and drive the nav's
 * active state; everything else is an overlay on top of whichever tab
 * is underneath, dismissed by `back()`. The URL is the source of truth
 * (see `lib/routes.ts`): `navigate()` pushes a history entry for every
 * addressable route, a `popstate` listener re-syncs `tab`/`overlay`
 * when the user hits Back/Forward or the page is restored from
 * history, and the initial state is parsed from `window.location` so
 * a refresh or a direct link lands on the right screen instead of
 * always resetting to Home.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<MainTabId>(() => {
    const route = initialRoute();
    return isTabRoute(route) ? route.screen : 'home';
  });
  const [overlay, setOverlay] = useState<OverlayRoute | null>(() => {
    const route = initialRoute();
    return isTabRoute(route) ? null : route;
  });

  useEffect(() => {
    function onPopState() {
      const route = routeFromPath(window.location.pathname + window.location.search);
      if (isTabRoute(route)) {
        setTab(route.screen);
        setOverlay(null);
      } else {
        setOverlay(route);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((route: Route) => {
    if (isTabRoute(route)) {
      setTab(route.screen);
      setOverlay(null);
    } else {
      setOverlay(route);
    }
    const path = pathForRoute(route);
    const currentPath = window.location.pathname + window.location.search;
    if (path !== null && path !== currentPath) {
      window.history.pushState(null, '', path);
    }
  }, []);

  // Only routes `navigate()` actually pushed a history entry for can
  // be popped — `menu`/`task`/`result` have no URL (see routes.ts), so
  // closing them just clears the overlay in place, same as before URL
  // routing existed.
  const back = useCallback(() => {
    if (overlay && pathForRoute(overlay) !== null) {
      window.history.back();
    } else {
      setOverlay(null);
    }
  }, [overlay]);

  // Memoized so a re-render of this provider (e.g. from a parent
  // provider's own state changing, unrelated to navigation) doesn't
  // hand every `useNavigation()` consumer in the tree a new object
  // identity and force them all to re-render — only an actual
  // tab/overlay change should do that.
  const value = useMemo<NavigationContextValue>(
    () => ({ tab, overlay, navigate, back }),
    [tab, overlay, navigate, back],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return ctx;
}

function isTabRoute(route: Route): route is { screen: MainTabId } {
  return (mainTabIds as readonly string[]).includes(route.screen);
}
