import type {
  AttemptRequest,
  AttemptResult,
  CollectionListItem,
  EssayAckResponse,
  FavoritesListResponse,
  LearningProfileResponse,
  AuthUser,
  IdentitiesResponse,
  IdentityProvider,
  LearningSessionResponse,
  MeResponse,
  MagicLinkResponse,
  Mistake,
  ProgressByTaskNumberResponse,
  ProgressByTopicResponse,
  ProgressDailyResponse,
  ProgressSummary,
  SaveLearningProfileRequest,
  SimilarTaskEntry,
  StreakResponse,
  TaskCountsBySubjectResponse,
  TaskNumberStatisticsDetail,
  TaskPublic,
  TaskWithSolution,
  VariantDetail,
  VariantProgressResponse,
} from '@zybrilka/shared';

const ANON_ID_STORAGE_KEY = 'zybrilka_anon_id';

/**
 * Stable per-browser identity until real auth (S3) exists — generated
 * once, kept in localStorage, sent as `x-anon-id` on every API call so
 * the server can attribute attempts/mistakes/progress to "this
 * browser" without a login. See apps/api/src/plugins/anonUser.ts.
 */
export function getAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(ANON_ID_STORAGE_KEY, created);
    return created;
  } catch {
    // Private browsing / storage blocked — still usable within this
    // page load, just not persisted across visits.
    return crypto.randomUUID();
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Subscribes to "the server says there is no valid session" (a 401 from
 * any private endpoint — the session expired, was revoked, or deleted).
 * The auth provider uses this to drop the client's signed-in state and
 * close the private screens. Returns an unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // An absolute URL (resolved against the current origin) rather than a
  // bare relative path — Node's fetch (used by jsdom in tests) has no
  // document base URI to resolve a relative path against, unlike a real
  // browser. Same-origin request either way, so this doesn't change
  // behavior for the app itself (still goes through vite's /api proxy).
  const url = new URL(`/api/v1${path}`, window.location.origin);
  const response = await fetch(url, {
    ...init,
    headers: {
      // Only when there's a body to describe — Fastify's default JSON
      // parser rejects a request that *declares* 'application/json'
      // but sends no body at all (e.g. DELETE /favorites/:taskId),
      // with a 400 "Body cannot be empty" rather than treating no
      // content-type as no body to parse.
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      'x-anon-id': getAnonId(),
      ...init?.headers,
    },
  });
  // `/auth/*` answers are about signing in/out themselves (e.g. a failed
  // magic-link verify is a 400, logout is a 204) — only a 401 from a
  // private endpoint means "the session you thought you had is gone".
  if (response.status === 401 && !path.startsWith('/auth/')) {
    unauthorizedListeners.forEach((listener) => listener());
  }
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(response.status, body);
  }
  // A 204 (e.g. favorites' add/remove) has no body — calling .json() on
  // it throws (SyntaxError: Unexpected end of JSON input), not the
  // empty-but-valid result callers expect.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getTask(id: string): Promise<TaskPublic | TaskWithSolution> {
  return apiFetch(`/tasks/${id}`);
}

export function getRandomTask(params: {
  subject?: string;
  taskNumber?: number;
  /** Collection slug — restricts the random pick to that collection's tasks. */
  collection?: string;
  /** A specific variant's id — restricts the random pick to just that variant. */
  variant?: string;
  /** A specific topic's id — restricts the random pick to that topic. */
  topic?: string;
  /** Excludes any task the current user already has an attempt on —
   * see Training's "Не встречавшиеся" toggle. A 404 `no_unseen_tasks`
   * (distinct from the generic `no_tasks_available`) means the pool
   * exists but every task in it was already seen. */
  unseen?: boolean;
}): Promise<TaskPublic> {
  const query = new URLSearchParams();
  if (params.subject) query.set('subject', params.subject);
  if (params.taskNumber) query.set('taskNumber', String(params.taskNumber));
  if (params.collection) query.set('collection', params.collection);
  if (params.variant) query.set('variant', params.variant);
  if (params.topic) query.set('topic', params.topic);
  if (params.unseen) query.set('unseen', 'true');
  const qs = query.toString();
  return apiFetch(`/tasks/random${qs ? `?${qs}` : ''}`);
}

export function listCollections(): Promise<CollectionListItem[]> {
  return apiFetch<{ items: CollectionListItem[] }>('/collections').then((r) => r.items);
}

export function getVariant(id: string): Promise<VariantDetail> {
  return apiFetch(`/variants/${id}`);
}

/**
 * Resolves the (published) variant a task belongs to — the ordered
 * exam context used for top-strip navigation, prev/next, and Result's
 * "Следующее задание", when only a taskId is known (not yet an
 * explicit variantId). `collection` isolates the resolution to one
 * source; throws (via ApiError, 404) when the task isn't part of any
 * matching variant.
 */
export function getVariantForTask(taskId: string, collection?: string): Promise<VariantDetail> {
  const qs = collection ? `?collection=${encodeURIComponent(collection)}` : '';
  return apiFetch(`/variants/for-task/${taskId}${qs}`);
}

/**
 * Every published task sharing one exam number — used both for the
 * cross-source "Другие задания" comparison list (no `collection`/
 * `unsolved`, the whole bank) and, since the navigation bugfix below,
 * as the real ordered list for "По номерам" with exactly one number
 * selected (`collection` then scopes it exactly like every other entry
 * point's 🎲 toggle already does — see `resolveSingleNumberSession`).
 *
 * `unsolved` excludes any task the current user has a CORRECT attempt
 * on — "По номерам"'s «Только нерешённые» checkbox, deliberately a
 * different filter from `getRandomTask`'s `unseen` (which excludes a
 * task on any attempt at all — see the shared `taskListQuerySchema`'s
 * doc comment on `unsolved` for the full distinction).
 */
export function listTasksByNumber(
  subject: string,
  taskNumber: number,
  collection?: string,
  unsolved?: boolean,
): Promise<TaskPublic[]> {
  const query = new URLSearchParams({ subject, taskNumber: String(taskNumber) });
  if (collection) query.set('collection', collection);
  if (unsolved) query.set('unsolved', 'true');
  return apiFetch<{ items: TaskPublic[] }>(`/tasks?${query.toString()}`).then((r) => r.items);
}

/**
 * Real published-task counts for every subject in one request — Home's
 * subject cards use this instead of the static `taskCount` in
 * subjects.ts. A subject with no rows here has 0 published tasks.
 */
export function getTaskCountsBySubject(): Promise<TaskCountsBySubjectResponse> {
  return apiFetch('/tasks/counts');
}

/**
 * Mistakes' "Решить похожее" — the existing deterministic Phase 6
 * similarity engine (`calculateTaskSimilarity`, never AI/ML), scored
 * against every other published task in the same subject. An empty
 * `items` array (small catalog today, or a task with no close match
 * yet) is a real, honest result — callers must show an empty state,
 * never fabricate a candidate.
 */
export function getSimilarTasks(taskId: string, limit?: number): Promise<SimilarTaskEntry[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return apiFetch<{ items: SimilarTaskEntry[] }>(`/tasks/${taskId}/similar${qs}`).then(
    (r) => r.items,
  );
}

/**
 * The real streak state (currentStreak/lastActiveDate/isActiveToday),
 * computed server-side in Europe/Moscow — see
 * packages/shared/src/learning/streak.ts. Never computed here.
 */
export function getStreak(): Promise<StreakResponse> {
  return apiFetch('/progress/streak');
}

export function submitAttempt(taskId: string, request: AttemptRequest): Promise<AttemptResult> {
  return apiFetch(`/tasks/${taskId}/attempt`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/** "Я решил" for an essay task — not a graded attempt, see EssayAckResponse's doc comment. */
export function acknowledgeEssay(taskId: string): Promise<EssayAckResponse> {
  return apiFetch(`/tasks/${taskId}/essay-ack`, { method: 'POST' });
}

export function getMistakes(): Promise<Mistake[]> {
  return apiFetch<{ items: Mistake[] }>('/mistakes').then((r) => r.items);
}

export function getProgressSummary(): Promise<ProgressSummary> {
  return apiFetch('/progress/summary');
}

/**
 * Real X/Y for the "По номерам" grid — `total` real, unique published
 * tasks per number under the given filters, `completed` real, unique
 * tasks the current user has attempted. No `collection`/`variant`
 * means the aggregate bank across every source; passing one scopes to
 * just that source, exactly like `getRandomTask`.
 */
export function getProgressByTaskNumber(params: {
  subject?: string;
  collection?: string;
  variant?: string;
}): Promise<ProgressByTaskNumberResponse> {
  const query = new URLSearchParams();
  if (params.subject) query.set('subject', params.subject);
  if (params.collection) query.set('collection', params.collection);
  if (params.variant) query.set('variant', params.variant);
  const qs = query.toString();
  return apiFetch(`/progress/by-task-number${qs ? `?${qs}` : ''}`);
}

/**
 * Real X/Y per real DB topic (never the static per-subject design
 * content) — same total/completed contract and source scoping as
 * `getProgressByTaskNumber`.
 */
export function getProgressByTopic(params: {
  subject?: string;
  collection?: string;
  variant?: string;
}): Promise<ProgressByTopicResponse> {
  const query = new URLSearchParams();
  if (params.subject) query.set('subject', params.subject);
  if (params.collection) query.set('collection', params.collection);
  if (params.variant) query.set('variant', params.variant);
  const qs = query.toString();
  return apiFetch(`/progress/by-topic${qs ? `?${qs}` : ''}`);
}

/**
 * Statistics 2.0 — the "По номерам → №N" detail (real attempts/
 * errors/skills/speed-signal breakdown for one subject+taskNumber).
 */
export function getTaskNumberStatisticsDetail(
  subjectId: string,
  taskNumber: number,
): Promise<TaskNumberStatisticsDetail> {
  return apiFetch(
    `/progress/by-task-number/${taskNumber}/detail?subject=${encodeURIComponent(subjectId)}`,
  );
}

/**
 * Real per-day activity for the "Активность по дням" chart — see
 * apps/api/src/modules/progress/repo.ts's getDaily for the exact
 * bucketing/dedup rules. Only days with at least one attempt come
 * back; callers zero-fill the requested range themselves.
 */
export function getProgressDaily(
  params: { days?: number; subject?: string } = {},
): Promise<ProgressDailyResponse> {
  const query = new URLSearchParams();
  if (params.days) query.set('days', String(params.days));
  if (params.subject) query.set('subject', params.subject);
  const qs = query.toString();
  return apiFetch(`/progress/daily${qs ? `?${qs}` : ''}`);
}

/** All of the current user's favorited task ids — see apps/api's
 * favorites module. Used to answer "is this task favorited?" for
 * whichever task is currently open without a separate round trip. */
export function listFavoriteTaskIds(): Promise<FavoritesListResponse> {
  return apiFetch('/favorites');
}

export function addFavorite(taskId: string): Promise<void> {
  return apiFetch('/favorites', { method: 'POST', body: JSON.stringify({ taskId }) });
}

export function removeFavorite(taskId: string): Promise<void> {
  return apiFetch(`/favorites/${taskId}`, { method: 'DELETE' });
}

/** DB is the source of truth for whether onboarding is done — see
 * apps/api's learningProfile module. Never inferred from localStorage. */
export function getLearningProfile(): Promise<LearningProfileResponse> {
  return apiFetch('/me/learning-profile');
}

export function saveLearningProfile(
  request: SaveLearningProfileRequest,
): Promise<LearningProfileResponse> {
  return apiFetch('/me/learning-profile', { method: 'PUT', body: JSON.stringify(request) });
}

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — thin, typed wrappers over
 * the real backend session lifecycle (Phase 9). No scoring/selection
 * logic lives here or anywhere in the frontend: these just forward to
 * the authoritative endpoints and return their real response shape
 * from `@zybrilka/shared`, unmodified.
 */
export function startLearningSession(params: {
  subjectId?: string;
  limit?: number;
  /** Smart Training's 🔄/🎲 — see the shared doc on
   * GetLearningPathContext for what each one changes. */
  unseenOnly?: boolean;
  randomizeTopTier?: boolean;
}): Promise<LearningSessionResponse> {
  return apiFetch('/me/learning/sessions', { method: 'POST', body: JSON.stringify(params) });
}

/** Must only be called after the user has actually submitted an
 * attempt on the current task — calling it any earlier would make the
 * backend recompute and consume a task slot the user never answered
 * (see Phase 9/10's "next only after a real submission" rule). */
export function getLearningSessionNext(sessionId: string): Promise<LearningSessionResponse> {
  return apiFetch(`/me/learning/sessions/${sessionId}/next`);
}

/** Read-only — never advances the session. Used only to recover "which
 * task was I on" after a page reload or direct link to
 * `/learning/session/:sessionId` (Phase 10 refresh-safety). */
export function getLearningSession(sessionId: string): Promise<LearningSessionResponse> {
  return apiFetch(`/me/learning/sessions/${sessionId}`);
}

/**
 * Training's "Вариант" mode — starts a real VARIANT session over one
 * real published exam variant's own task order (never scored, never a
 * recommendation). Returns the exact same `LearningSessionResponse`
 * shape as `startLearningSession`, so it goes through the same
 * `applyLearningSessionResponse`/`LearningSession` screen — Desktop and
 * Mobile get the same completion flow for free.
 */
export function startVariantSession(variantId: string): Promise<LearningSessionResponse> {
  return apiFetch('/me/learning/sessions/variant', {
    method: 'POST',
    body: JSON.stringify({ variantId }),
  });
}

/**
 * Statistics' "Статистика вариантов" — every real variant session the
 * current user has ever started (any status, newest first). See
 * `VariantProgressItem`'s doc comment for field semantics.
 */
export function getVariantProgress(): Promise<VariantProgressResponse> {
  return apiFetch('/progress/variants');
}

/**
 * Login/signup screen's email step — always resolves the same way
 * whether or not `email` has an account (see apps/api's auth service
 * doc comment); callers must never infer "this email exists" from a
 * response difference. Can reject with `ApiError(503)` when SMTP isn't
 * configured on the backend — the screen must show this honestly
 * rather than claiming a link was sent.
 */
export function requestMagicLink(email: string): Promise<MagicLinkResponse> {
  return apiFetch('/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Exchanges the token from the emailed magic link for a real session
 * (the server sets the session cookie) — `ApiError(400)` means the
 * link is invalid, already used, or expired. */
export function verifyMagicLink(token: string): Promise<{ user: AuthUser }> {
  return apiFetch('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
}

/** The VK ID "Продолжить через ВКонтакте" button's target — a plain
 * navigation (not a fetch), since this must trigger a real browser
 * redirect to id.vk.com. Resolves to this API's own `/auth/vk/start`,
 * which 503s with `vk_not_configured` if the backend has no VK
 * credentials set up yet — never a URL that only looks like it works. */
export function vkLoginUrl(): string {
  return new URL('/api/v1/auth/vk/start', window.location.origin).toString();
}

/** The current session's user, or `null` when signed out — never
 * throws for "not logged in" (see /auth/me's always-200 contract),
 * only for an actual network/server failure. */
export function getCurrentUser(): Promise<MeResponse> {
  return apiFetch('/auth/me');
}

export function logout(): Promise<void> {
  return apiFetch('/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------- profile

/** Sets the user's own display name; `null` (or blank) goes back to the
 * name the sign-in provider supplied. Resolves to the refreshed user. */
export function updateProfileName(displayName: string | null): Promise<{ user: AuthUser }> {
  return apiFetch('/me/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) });
}

/** Uploads the (already downsized) avatar as raw bytes. The server decides
 * what the file really is; the browser's `type` is only a hint. */
export function uploadAvatar(image: Blob): Promise<{ user: AuthUser }> {
  return apiFetch('/me/avatar', {
    method: 'PUT',
    body: image,
    headers: { 'content-type': image.type },
  });
}

export function deleteAvatar(): Promise<{ user: AuthUser }> {
  return apiFetch('/me/avatar', { method: 'DELETE' });
}

// -------------------------------------------------------- sign-in methods

export function getIdentities(): Promise<IdentitiesResponse> {
  return apiFetch('/me/identities');
}

export function unlinkIdentity(provider: IdentityProvider): Promise<IdentitiesResponse> {
  return apiFetch(`/me/identities/${provider}`, { method: 'DELETE' });
}

export function linkTelegram(
  initData: string,
): Promise<{ status: 'linked' | 'already_linked'; user: AuthUser }> {
  return apiFetch('/me/identities/telegram', {
    method: 'POST',
    body: JSON.stringify({ initData }),
  });
}

/** Navigation target that ADDS VK to the signed-in account (a full-page
 * redirect, like the VK sign-in button). The server reads the account from
 * the session, not from this URL. */
export function vkLinkUrl(): string {
  return new URL('/api/v1/auth/vk/start?link=1', window.location.origin).toString();
}

/** Signs in (or registers) with the signed Telegram Mini App launch data. */
export function loginWithTelegram(initData: string): Promise<{ user: AuthUser; created: boolean }> {
  return apiFetch('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
}
