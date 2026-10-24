# ZYBRILKA — Architecture

Status: **approved** (2026-09-24). This document is the reference for all implementation stages.
Changes to the architecture must be proposed, approved, and recorded here.

---

## 1. Principles

One repository, one database, a few processes on one server. No microservices, no Kubernetes.
Priorities (from CLAUDE.md): correctness → security → stable architecture → performance → mobile UX → clean code → visuals → speed.

## 2. Architecture overview

```
Browser / Telegram WebView
        │  (same origin: zybrilka.ru  and  zybrilka.ru/api)
        ▼
  Caddy (HTTPS, static files, gzip/brotli)
   ├── /        → web (static SPA build)
   └── /api/*   → api (Node, Fastify)  ── PostgreSQL
                                          ▲
  worker (same codebase): import pipeline,│ analytics rollups,
  Telegram bots, scheduled jobs  ─────────┘ (pg-boss queue in Postgres)
  Object storage (S3-compatible): task images, uploaded PDFs/DOCX
```

## 3. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript 6.0** throughout | Shared types and validation between frontend and backend. Not 7.x yet: typescript-eslint supports `<6.1` |
| Monorepo | **pnpm workspaces** | Simple and fast, no extra tooling (Nx/Turbo) |
| Frontend | **React + Vite**, TanStack Router + Query, CSS Modules + CSS variables for design tokens | Small static SPA, fast in Telegram WebView and Safari, CDN-cacheable, per-route code splitting |
| UI extras | KaTeX (formulas), lightweight charts (uPlot or Recharts, lazy-loaded), Canvas + Pointer Events for the scratchboard | Small bundle |
| Backend | **Fastify** (Node 22 LTS) | Fast, mature, schema validation, rate limiting, WebSockets later for battles |
| Validation | **Zod** in `packages/shared` | One schema validates on client and server |
| Database | **PostgreSQL 16** | Reliable relational data, JSONB where flexible, strong analytics queries |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed, SQL-like, plain reviewable SQL migrations |
| Local/test DB | **PGlite** (Postgres in WASM) or Docker Postgres | Same dialect → test-to-production is only a connection-string change |
| Job queue | **pg-boss** (on Postgres) | No Redis. Imports, rollups, bot notifications. Added with the first real job |
| Telegram | **grammY** | Typed. Mini App bot and support/admin bot |
| Tests | Vitest (unit, API), Playwright (e2e, mobile viewports) | |
| CI | GitHub Actions: lint, typecheck, test, build | |
| Deployment | One VPS + Docker Compose (Caddy, api, worker, postgres) + S3-compatible storage | Cheap, simple, automatic HTTPS |

**What runs where**
- Locally / in dev containers: everything (web, api, worker, PGlite or Postgres).
- Needs a server: production DB, HTTPS (required by Telegram Mini Apps), bot webhook, backups.
- Migration to production: set `DATABASE_URL` to real Postgres → `pnpm db:migrate` → deploy Docker images.

Public SEO landing pages, if needed, are added later as prerendered static pages.

## 4. Database schema (main tables)

```
── Users & auth
users(id, created_at, last_seen_at, display_name, avatar_url, role[user|moderator|admin],
      onboarding_completed, diagnostic_completed_at, xp, level, timezone, is_banned)
auth_identities(id, user_id, provider[telegram|guest|email], provider_user_id UNIQUE, created_at)
sessions(id, user_id, token_hash, expires_at, user_agent_hash, created_at)
user_subjects(user_id, subject_id, target_score, exam_year)

── Content
subjects(id, slug, name, exam_year_active)
exam_formats(id, subject_id, year, spec_source_url, is_current)   -- keeps each year's format separate
task_numbers(id, subject_id, year, number, part[1|2], answer_type, max_score, title)
topics(id, subject_id, parent_id, slug, name)                     -- topic → subtopic tree
tasks(id, subject_id, year, task_number_id, topic_id, subtopic_id, difficulty(1-5),
      difficulty_rating, condition_md, options JSONB, answer_type,
      correct_answer JSONB, answer_rules JSONB,   -- answer normalization/comparison rules
      explanation_md, explanation_source[official|human|ai_verified],
      source_id, source_ref, source_url, content_hash, normalized_text,
      status[draft|review|published|hidden|archived], date_added,
      solve_count, correct_count, complaint_count, version)
task_images(id, task_id, storage_key, width, height, alt)
task_similarity(task_id, similar_task_id, score, kind[manual|auto])

── Learning
attempts(id, user_id, task_id, session_id, answer_raw, answer_normalized, is_correct,
         time_spent_ms, hint_used, explanation_opened,
         context[training|diagnostic|mistakes|review|variant|battle],
         is_similar_followup, parent_attempt_id, created_at)
mistakes(id, user_id, task_id, first_attempt_id, last_attempt_id, times_wrong,
         status[open|reviewing|resolved], next_review_at, interval_days, ease,   -- spaced repetition
         similar_task_result, error_type)
user_topic_stats(user_id, topic_id, attempts, correct, recent_correct_ewma,
                 mastery (Elo-style), last_practiced_at, updated_at)   -- input for adaptive training
training_sessions(id, user_id, mode, filters JSONB, planned_task_ids int[], started_at, finished_at, score)
diagnostics(id, user_id, subject_id, started_at, completed_at, result JSONB)   -- per-topic %

── Gamification
achievements(id, slug, name, description, rule JSONB, icon, is_active)
user_achievements(user_id, achievement_id, unlocked_at)
achievement_rarity(achievement_id, active_users_base, unlocked_count, computed_at)
streaks(user_id, current, longest, last_active_date)
xp_events(id, user_id, amount, reason, ref_id, created_at)        -- append-only, auditable XP
leaderboard_snapshots(period, period_start, user_id, score, rank)

── Battles (later phase)
battles(id, mode[fast|rated], status, task_ids int[], created_at, started_at, finished_at, seed)
battle_players(battle_id, user_id, score, correct, total_time_ms, rating_before, rating_after, result)
battle_answers(battle_id, user_id, task_index, answer, is_correct, server_received_at,
               UNIQUE(battle_id, user_id, task_index))
user_ratings(user_id, subject_id, rating, rd, games)

── Moderation
complaints(id, task_id, user_id, reason, comment, status[new|accepted|rejected|fixed],
           admin_id, admin_note, tg_message_id, created_at, resolved_at)
admin_audit_log(id, admin_id, action, entity, entity_id, diff JSONB, created_at)

── Import center
sources(id, name, kind[manual|official_api|export|url], base_url, license_notes,
        automation_allowed, storage_allowed, attribution, is_active)
imports(id, source_id, admin_id, kind[pdf|docx|json|csv|images|url], file_key,
        status[queued|parsing|parsed|reviewing|done|failed], stats JSONB, error, created_at)
import_items(id, import_id, raw JSONB, parsed JSONB, warnings JSONB, confidence,
             duplicate_of_task_id, dup_score, decision[pending|add|merge|skip],
             resulting_task_id, reviewed_by, reviewed_at)

── Analytics
events(id BIGSERIAL, user_id, anon_id, name, props JSONB, platform[web|tg], created_at)  -- monthly partitions later
daily_stats(date, metric, dimension, value)   -- precomputed rollups for the admin dashboard
```

**Foundation (S0):** the first migration creates only `app_settings` (runtime key/value settings). Each product table above is added by the stage that uses it.

**Rules**
- The correct answer and explanation are **never sent to the client before the attempt is recorded on the server.**
- Every schema change goes through a migration.

## 5. API structure

Base path `/api/v1`, JSON, all input validated with Zod.
`GET /health` is served outside `/api` for container/uptime probes: version, uptime, DB status; `503` when the DB is down.

```
Auth
POST /auth/telegram        {initData} → server-side validation → session
POST /auth/guest           → anonymous user (web), linkable to Telegram later
POST /auth/telegram-login  (Telegram Login Widget, website)
POST /auth/logout          GET /me   PATCH /me

Onboarding / diagnostic
PUT  /me/subjects
POST /diagnostics                  → start (adaptive: server picks the next task)
POST /diagnostics/:id/answer       → next task or final profile
GET  /diagnostics/:id/result

Content
GET /subjects   GET /subjects/:id/topics   GET /subjects/:id/task-numbers

Training
POST /training/sessions            {mode: topic|mistakes|review|smart|variant, filters}
GET  /training/sessions/:id/next
POST /attempts                     {taskId, sessionId, answer, timeSpentMs}
                                   → {correct, correctAnswer, explanation, topic, errorType}
POST /attempts/:id/explanation-opened
GET  /tasks/:id/similar
POST /training/sessions/:id/finish

Progress
GET /progress/summary   GET /progress/topics   GET /progress/timeline?period=
GET /mistakes           GET /achievements      GET /leaderboard?period=&subject=

Complaints
POST /tasks/:id/complaints

Admin (/api/v1/admin/*, role admin|moderator, every write audited)
GET/POST/PATCH /tasks, POST /tasks/:id/publish|hide
GET /complaints, PATCH /complaints/:id
GET /stats/users|tasks|activity|funnel|retention?from=&to=
GET/POST /sources
POST /imports (upload), GET /imports/:id, GET /imports/:id/items
PATCH /import-items/:id {decision, edits}, POST /imports/:id/publish

Telegram
POST /telegram/webhook/:secret     (bot updates, verified by secret token header)

Battles (later): WS /battles/ws + POST /battles/queue
```

## 6. Project structure

```
Zybrilka/
├── apps/
│   ├── web/            React SPA: app + /admin (lazy-loaded) + Telegram adapter
│   │   └── src/{routes,features/{onboarding,training,progress,achievements,scratchboard,admin},ui,lib}
│   ├── api/            Fastify: src/{modules/<domain>/{routes,service,repo}.ts, plugins/{auth,rateLimit,security}}
│   └── worker/         pg-boss jobs: import pipeline, rollups, achievements, bots
├── packages/
│   ├── db/             Drizzle schema, migrations/, seed/; `@zybrilka/db/testing` (PGlite for tests)
│   ├── shared/         Zod schemas, API types, answer normalization/checking, constants
│   └── adaptive/       pure functions: priority scoring, mastery updates, spaced repetition
├── design/             5 concept prototypes → chosen design tokens
├── docs/               ARCHITECTURE.md, DECISIONS.md, SOURCES.md (legal status per content source)
├── infra/              docker-compose.yml, caddy/Caddyfile, backup scripts
├── .github/workflows/  ci.yml
└── CLAUDE.md
```

Workspace packages export compiled `dist/` by default and their TypeScript source under the custom `@zybrilka/source` export condition. Dev tools (Vite, Vitest, tsx, `tsc --noEmit`) use the source condition, so development and tests never depend on a prior build; production runs the compiled output.

## 7. Telegram Mini App

- **One SPA, two environments.** A `platform` adapter detects `window.Telegram.WebApp`: Telegram theme parameters, BackButton/MainButton, haptics, viewport and safe-area insets. On the web: normal navigation.
- **Authentication:** the client sends raw `initData`. The server verifies the HMAC-SHA256 signature (secret key = `HMAC_SHA256("WebAppData", BOT_TOKEN)`), rejects stale `auth_date` (~24h), upserts `auth_identities(telegram, tg_id)` and issues a session token. **`initDataUnsafe` is never trusted.**
- **Sessions:**
  - Telegram: token in the `Authorization` header, kept in memory with a `sessionStorage` fallback; on expiry the client re-sends `initData`. Avoids cookie issues in the Telegram iframe and Safari ITP.
  - Web: httpOnly, Secure, SameSite=Lax cookie on the same origin.
- **Account linking:** a web guest links Telegram via the Login Widget; progress is merged into one account.
- **WebView specifics:** `100dvh`, safe areas, no hover-only interactions, no `alert()`, `expand()`; test on iOS Telegram (WKWebView) and Android Telegram.
- **Bot:** Mini App launch button, `/start` deep links (e.g. `startapp=task_123`), later streak reminders.

## 8. Admin

- Same SPA under `/admin`, a separate lazy-loaded bundle.
- **Protection is server-side:** every `/admin/*` route checks `role`. Hidden UI is not protection.
- Roles: `admin` (everything), `moderator` (tasks, complaints, imports; no user management). All admin writes go to `admin_audit_log`.
- Shorter admin sessions; sensitive actions may require re-authentication. Admins are created by a CLI seed command, never through public sign-up.
- **Dashboard:** reads `daily_stats` rollups plus live queries for "today". Users (new, DAU, activity buckets 1+/2+/10+/50+/100+, entered-but-inactive), tasks by status/subject/number, activity, funnel, retention.
- **Support bot:** new complaint → worker job → message to the admin chat with inline buttons (Open / Accept / Reject / Fixed). The bot checks that the button presser's Telegram ID belongs to an admin before applying the action.

## 9. Import Center

```
upload / source URL → store original file (object storage) → import row (queued)
  → worker: parse (JSON/CSV directly; DOCX via mammoth; PDF via text extraction; images stored)
  → structure: split into items {condition, options, answer, explanation, number, year}
  → answer detection (patterns + answer-key section matching) → confidence score
  → classify: subject/number from metadata; topic by rules + keywords (AI suggestion later, marked "unverified")
  → quality checks: missing answer, broken formulas/images, number not matching the year's format
  → deduplicate: source_ref → content_hash → normalized-text trigram similarity (pg_trgm)
  → import_items (draft) → admin review (preview, warnings, side-by-side duplicate: skip/merge/add)
  → publish → tasks(status=published)
```

- MVP: JSON and CSV import plus manual task entry. Phase 2: DOCX, PDF, images.
- Scheduled source monitoring only when `sources.automation_allowed = true` and the source is reviewed in `docs/SOURCES.md`.
- No scraping where not permitted; never bypass CAPTCHA, authentication or anti-bot protections.
- Uncertain answers and AI-drafted content always go to `review`; never auto-published.
- Every imported task retains its source information.

## 10. Analytics

- Own event log, no third-party trackers.
- Server-side events wherever possible (answer submitted, correct/incorrect, diagnostic, achievement, complaint) — cannot be faked or blocked.
- UI-only events (task opened, explanation opened, similar task opened) via batched `POST /events`, rate-limited, event names allowlisted.
- Worker aggregates `events` into `daily_stats` every 5–15 minutes; the dashboard reads aggregates.
- Retention cohorts and funnel computed from `users.created_at` + `attempts`/`events`.
- Minimal personal data: Telegram ID, display name, optional avatar. No phone numbers or emails in the MVP.

## 11. Adaptive training (summary)

- Per-topic mastery (Elo-style) updated on every attempt against the task's difficulty rating.
- Topic priority combines: error rate, recent errors (exponential decay), repeated errors, attempt count, difficulty, time since last practice, recent improvement, similar-task performance; plus a small exploration share.
- Mistakes are scheduled with spaced repetition (`mistakes.next_review_at`, `interval_days`, `ease`).
- Implemented as pure, unit-tested functions in `packages/adaptive`.

## 12. Security summary

- Server-side validation (Zod) on every input; parameterized queries via Drizzle.
- Telegram `initData` validated server-side; role-based authorization; protected admin routes.
- Secrets only in environment variables; never in frontend code or the repository.
- Rate limiting (per IP and per user), secure headers, same-origin API (no permissive CORS), output escaping (React + sanitized Markdown/KaTeX).
- Answers/explanations released only after the attempt is stored.
- Anti-farming: difficulty-weighted XP, daily caps. Battles: server-only scoring, unique constraints on answers, server timestamps.

## 13. MVP roadmap

Each stage ends **tested + committed + pushed to GitHub**.

**MVP**
- **S0 — Foundation:** monorepo, lint/format, TypeScript, Vitest, CI, Drizzle + first migration, `/health`.
- **S1 — Design:** 5 genuinely different concepts as clickable mobile HTML prototypes → selection → design system (tokens + base components).
- **S2 — Task engine:** subjects/topics/tasks schema, seed tasks, answer checker (comma/dot, spaces, ё/е, case, order-insensitive multi-digit answers), task screen, KaTeX, explanation after checking.
- **S3 — Auth:** Telegram `initData` validation, web guest, sessions, rate limiting, security headers.
- **S4 — Onboarding + diagnostic:** subject selection, 10–20 task adaptive diagnostic, skill profile, "Retake diagnostic".
- **S5 — Mistakes + progress:** attempts/mistakes model, "Мои ошибки" as a real training mode, spaced repetition, progress screens.
- **S6 — Adaptive training:** topic priority scoring, "similar task" after a mistake.
- **S7 — Complaints + minimal admin:** "⚠️ Пожаловаться", admin task editing, complaint handling.
- **S8 — Import (JSON/CSV):** with review and duplicate screens.
- **S9 — Scratchboard:** "Расширить поле" — draw, erase, undo, clear; touch and stylus.
- **S10 — Production deploy:** VPS, HTTPS, Mini App registration, backups (requires approval: paid service).

**Phase 2:** XP, streaks, achievements with rarity; full admin dashboard (charts, funnel, retention); support bot with inline buttons; DOCX/PDF import; leaderboards; full EGE variants with timer.

**Later:** PvP battles (fast, then rated); AI-drafted explanations with human review; source monitoring; more subjects; optional ad removal.

## 14. Risks and unknowns

1. **Task content licensing (biggest risk).** Terms of ФИПИ materials and third-party sites (e.g. "Решу ЕГЭ") for storage and republication are unclear or restrictive. Each source needs a documented decision in `docs/SOURCES.md`. Options: official open materials with attribution (to be verified), original tasks, user-uploaded material with rights.
2. **152-ФЗ data localization.** Personal data of Russian citizens generally must first be stored in databases in Russia → prefer a Russian VPS (Selectel / Timeweb / Yandex Cloud). Many users are minors → minimal data collection.
3. **Current exam formats.** 2027 specifications may not be final as of September 2026. The schema separates formats per year; content must be checked against official documents.
4. **Part 2 (written-solution) tasks** cannot be auto-checked. MVP: self-assessment against official criteria, tracked separately in statistics.
5. **Telegram WebView quirks** (iOS keyboard/viewport jumps, cookie restrictions). Mitigation: token sessions, early real-device testing.
6. **Explanation quality at scale.** Writing is slow; AI drafts require review.
7. **Leaderboard farming / battle cheating.** Difficulty-weighted XP, daily caps, server-side results, unique answer constraints.

## 15. Open decisions

- MVP subject(s) — recommendation: профильная математика part 1 first, Russian language second.
- Logo / bison mascot asset — provided by owner, or placeholder for concepts.
- Initial content source with usage rights — or a small original seed set + JSON import.
- Hosting location (Russia recommended for 152-ФЗ), domain, Telegram bot token (server env only).

## 16. First steps

S0 (foundation) → S1 (5 design concepts) → S2 (task engine) on a single subject.

## 17. Answer engine — implemented answer types

Beyond §4's aspirational schema, this is what the answer engine actually checks today
(`packages/shared/src/{answerChecker,intervalAnswer,multiPartAnswer}.ts`, `tasks.answerType`).

`tasks.answerType` is one of `short_answer | multiple_choice | interval | multi_part`.
INTEGER/DECIMAL/FRACTION/FREE_TEXT are deliberately **not** separate types: `short_answer`'s
existing checker already normalizes commas/dots, whitespace, ё/е, case, and multi-value order,
so splitting them out would just duplicate that behavior with no difference in what's accepted.

**`interval`** — `tasks.correctAnswer` stays a single TEXT column holding a plain interval-set
string, e.g. `(-∞;3] ∪ (5;+∞)`. `checkIntervalAnswer` never compares strings directly: it parses
both sides into a normalized `Interval[]` (`{left, leftClosed, right, rightClosed}`, `±Infinity`
allowed) via a deterministic, non-`eval` recursive scanner — no `RegExp` spanning the whole
bracket, since a bound can contain its own parentheses (`log_5(2)`) that would collide with the
interval's own closing bracket. It accepts different bracket/separator/∪ vs `U`/spacing/negative
number/decimal conventions as equivalent, and sorts intervals so union order doesn't matter. An
unparseable string returns `null` from the parser and is graded incorrect — never a 500. Bounds
support integers, decimals, unary sign, `a/b` fractions, `π`, `e`, `√n`/`sqrt(n)`, and `log_b(x)`.
A "punctured" interval (one excluded point) has no special syntax — it's expressed as the union
of the two open sub-intervals split at that point (see task 15 below).

**`multi_part`** — reuses the same `tasks.correctAnswer` TEXT column, this time holding a
JSON-encoded `MultiPartSpec { parts: [{id, label, answerType, correctAnswer}] }`
(`serializeMultiPartSpec`/`parseMultiPartSpec`). `attempts.answerRaw` likewise holds a
JSON-encoded `{[partId]: answer}` object instead of a plain string
(`serializeMultiPartUserAnswer`/`parseMultiPartUserAnswer`) — no new tables for either. The
public `TaskPublic` DTO gets one extra field, `answerParts: {id, label}[] | null`, so the client
can render one input per part *before* an attempt exists, without ever exposing the correct
answer early. `POST /tasks/:id/attempt`'s `answer` field is `string | Record<string, string>`
(Zod union); the server infers which shape to expect from `answerType` and returns
`400 invalid_answer_shape` (never 500) on a mismatch.

**Partial correctness** — `gradeMultiPart` checks each part independently (each part's own
`answerType`, `short_answer` or `interval`) and returns
`{parts: [{id, label, correct}], correctParts, totalParts, status}` where `status` is
`all_correct | partially_correct | all_incorrect`. One multi_part submission is still one
attempt row — `POST /attempt` is called once with the whole answer object, not once per part —
and `AttemptResult` carries the per-part breakdown as optional fields alongside the existing
`correct`/`correctAnswer`/`explanation`, so every other answerType's response shape is untouched.
No EGE point/balл scoring is implemented — deliberately out of scope for now.

**Mistakes per part** — `mistakes` gained one nullable column, `wrongParts: string[] | null`
(the ids of the parts that were wrong on the *last* attempt; `null` for every non-multi_part
task). It's set on both the "first wrong attempt" and "wrong again" paths and left untouched
when an attempt later resolves the mistake, matching the existing `lastAttemptId` convention of
keeping a historical record of what was last wrong rather than clearing it on success. This is
the hook a future adaptive engine can use to target specific weak parts, not just weak topics.

**UI** — `interval` needs no UI changes: the existing single free-text input plus its
∪/∩/∞ hint text already covers it. `multi_part` renders one labeled input per
`task.answerParts` entry instead of the single field, with one shared "Проверить ответ" button
(`apps/web/src/screens/Task/{TaskDesktop,TaskMobile}.tsx`); the Result screens re-run
`gradeMultiPart` client-side (the task's `correctAnswer` and the JSON-encoded `userAnswer` are
both already available through existing channels) to render each part's own
correct/incorrect state and its own explanation section, split from `explanationMd` at its
`### <heading>` markers (`apps/web/src/lib/taskAdapter.ts`'s `splitMultiPartExplanation`).

## 18. Content model — Collections, Variants, membership (S3.2)

A quick diagram lives in `docs/PRODUCTION_DATA_MODEL.md`; this is the detail behind it.

**Ownership vs. membership.** A `Task` row is still owned by exactly `subjectId` + `topicId`,
same as §4. `collections` and `variants` are a separate *membership* layer on top, joined via
`variant_tasks` — a task never gets copied to also live "inside" a collection/variant/full-exam
view. The same physical row is found through all of them at once:

```
collections (e.g. "ЕГЭ 2026 Ященко")
      │ 1—N
variants (e.g. "Вариант 1", "Вариант 2", …)
      │ N—M, via variant_tasks(variantId, taskId, position)
tasks (owned by subjects/topics, unchanged)
```

- `variant_tasks.position` is the task's 1-based slot inside that variant's full exam (1..19 for
  Вариант 1) — the exam's own order, set once at import time, never touched by shuffle.
- `UNIQUE(variantId, taskId)` prevents the same task being linked into one variant twice; nothing
  stops the same task appearing in *two different* variants later (e.g. a repeated task across
  Вариант 2 and Вариант 5) — that's one `tasks` row with two `variant_tasks` rows, not a copy.
- **No `collection_tasks` table.** "Every task in a collection" is `variant_tasks` joined to
  `variants` filtered by `collectionId` (`apps/api/src/modules/tasks/repo.ts`'s
  `taskIdsForCollectionOrVariant`) — a separate table would just duplicate that membership.
- `collections`/`variants` each have their own `status` (`draft | published | archived`, no
  `needs_review` — review is per-task, not per-collection/variant). A collection or variant filter
  only ever matches a *published* one; an archived/draft one silently returns no tasks rather than
  leaking them, same "published-only, enforced server-side" rule as `tasks.status` in §4.

**Filtering.** `GET /tasks` and `GET /tasks/random` accept optional `collection` (slug) and
`variant` (id) query params, resolved to a task-id subquery scoped to a *published*
variant/collection (`taskIdsForCollectionOrVariant`). "По заданиям" (a task number, optionally
inside one collection) and "Сборник" (every task in a collection, across all its variants) are
both this same filter — there's no separate "по заданиям" endpoint, just `taskNumber` +
`collection` on the existing one.

**Full variant.** `GET /api/v1/variants/:id` returns `{variant, collection, tasks: [{position,
task}]}`, `tasks` ordered by `position` ascending — the exam's own order, always. Each `task` uses
the exact same public shape as every other listing (never `correctAnswer`/`explanationMd` before
an attempt exists). A missing, draft, archived, or needs_review-only variant is a 404. A separate
`GET /api/v1/collections` lists published collections with their published variants nested (small,
unpaginated by design — a "Сборник" picker needs the whole list at once, and the cardinality is
tiny compared to tasks).

**Ordered vs. shuffled.** `variant_tasks.position` is never reshuffled — "Полный вариант N" always
opens/steps through tasks in that exact order. Shuffle only ever applies to
`GET /tasks/random`'s own random pick (`ORDER BY random()` in `repo.ts`), which is a completely
separate query path from the ordered variant endpoint; nothing in `GET /variants/:id` involves
randomness. "Случайные N заданий №5 из Ященко" is `GET /tasks/random?collection=…&taskNumber=5`,
repeated — never a variant lookup.

**Deduplication is unchanged.** `tasks.contentHash` (hash of subjectId + taskNumber + normalized
statement, unique-indexed — §4/§15) still decides whether an incoming task is new. Importing the
same task into a second variant creates one new `variant_tasks` row against the *existing* task
id, never a second `tasks` row — this is exactly what `importEge2026Variant1.ts` does today for
Вариант 1's 19 tasks, and is the intended path for Вариант 2+ later (explicitly not started yet).
