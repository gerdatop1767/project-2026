import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Runtime key/value settings (feature flags, maintenance mode, etc.).
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Task engine (docs/ARCHITECTURE.md §4/§13 S2), trimmed to what the
 * current stage needs. Full auth (S3) doesn't exist yet, so `users`
 * here is intentionally minimal: just enough to give `attempts`/
 * `mistakes` a stable owner. Rows are created lazily for a
 * client-generated anonymous id (see apps/api's anon-user plugin) —
 * this is not an auth system, it's the FK target auth will attach to
 * later (`auth_identities` etc.), added when S3 actually lands.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

// Matches apps/web's data/subjects.ts ids (math, russian, ...) so seed
// content and the existing frontend subject list stay in sync.
export const subjects = pgTable('subjects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
  },
  (table) => [uniqueIndex('topics_subject_slug_idx').on(table.subjectId, table.slug)],
);

/**
 * 'interval' and 'multi_part' reuse the existing `correctAnswer`
 * column: for 'interval' it's still a plain interval-set string (see
 * @zybrilka/shared's intervalAnswer.ts); for 'multi_part' it's JSON
 * (see multiPartAnswer.ts). No separate columns per type.
 */
/**
 * 'essay' (e.g. EGE Russian task 27, развёрнутый ответ/сочинение): no
 * single correct answer exists or should ever be invented. `correctAnswer`
 * is stored as an empty-string sentinel (same convention as a
 * `needs_review` task with no confirmed answer yet) and is never compared
 * against a user's answer — `submitAttempt` rejects attempts on an
 * 'essay' task outright via `EssayNotGradableError` before any grading
 * logic runs. Added additively: zero migration (this is a TS-level
 * literal union over a plain text column, not a native Postgres enum).
 */
export const taskAnswerTypes = [
  'short_answer',
  'multiple_choice',
  'interval',
  'multi_part',
  'essay',
] as const;
/**
 * 'needs_review' (S3 import pipeline): parsed/solved but not safe to show a
 * real student yet — a mismatched/uncertain answer, an unsupported answer
 * shape (e.g. multi-part a/b/v), or an explanation that failed its own
 * validation pass. Never served by the public API alongside 'published'.
 */
export const taskStatuses = ['draft', 'published', 'archived', 'needs_review'] as const;

/**
 * A shared reading passage (Russian EGE §1 Текст 1-3, §23-27 литературный
 * текст; a prose/official-document excerpt multiple tasks reference by
 * number — "Прочитайте текст и выполните задания N-M") — stored ONCE
 * per passage, never duplicated into every referencing task's
 * `conditionMd`. A task that reads a passage links to it via
 * `tasks.passageId`; a task with no shared passage (most math tasks,
 * and most Russian tasks whose own short example sentence is entirely
 * self-contained) leaves it null. `bodyMd` keeps the original sentence
 * numbering "(1)...(2)..." exactly as printed, since several task
 * types (e.g. "среди предложений 33-41 найдите...") refer to those
 * numbers directly.
 */
export const passages = pgTable(
  'passages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    slug: text('slug').notNull(),
    title: text('title'),
    bodyMd: text('body_md').notNull(),
    /** Display label, e.g. "По М.А. Осоргину" or "Из Правил перевозки...". Null when the source gives no attribution. */
    sourceAuthor: text('source_author'),
    /** A footnote about the author printed under the passage (e.g. a short bio), kept verbatim and separate from `bodyMd`. */
    sourceNote: text('source_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('passages_subject_slug_idx').on(table.subjectId, table.slug)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    /** The official EGE question number within the subject (1, 2, 3…). */
    taskNumber: integer('task_number').notNull(),
    topicId: uuid('topic_id').references(() => topics.id),
    /** The shared passage this task reads, if any — see `passages` above. Null for a self-contained task. */
    passageId: uuid('passage_id').references(() => passages.id),
    /** 1 = лёгкое, 2 = среднее, 3 = сложное. */
    difficulty: integer('difficulty').notNull(),
    conditionMd: text('condition_md').notNull(),
    imageUrl: text('image_url'),
    answerType: text('answer_type', { enum: taskAnswerTypes }).notNull().default('short_answer'),
    /**
     * Per-task, explicit opt-in for `checkAnswer`'s
     * `digitSetOrderInsensitive` option (see `packages/shared/src/
     * answerChecker.ts`) — true only for a `short_answer` task whose
     * own wording ("Запишите номера ответов", "Укажите цифру(-ы)…")
     * genuinely accepts the selected digits in any order, per the
     * standard EGE multi-select answer convention. Defaults to false,
     * so every existing task (all math, and any Russian task not
     * explicitly marked) keeps the exact order-sensitive behavior it
     * always had — this column changes grading for ONLY the tasks it
     * is set true on, never globally. Never applies to `interval` or
     * `multi_part` answers, which have their own comparison logic.
     */
    digitSetOrderInsensitive: boolean('digit_set_order_insensitive').notNull().default(false),
    /** Never sent to the client before an attempt exists for it — see modules/tasks/service.ts. */
    correctAnswer: text('correct_answer').notNull(),
    /**
     * Optional presentation-only version of `correctAnswer` — LaTeX
     * ($...$) for a value whose plain form isn't real math typography
     * (e.g. "arccos(√10/5)", an interval-set string). Never read by
     * checkAnswer/checkIntervalAnswer/gradeMultiPart — those always
     * grade against `correctAnswer` itself, so this column can never
     * change what counts as a correct answer (EGE Fidelity: Final
     * Polish audit, Block 2 — machine value vs display value). Null
     * means `correctAnswer` is already fine to show as-is (most tasks
     * — a plain number needs no separate display form).
     */
    correctAnswerDisplay: text('correct_answer_display'),
    answerOptions: jsonb('answer_options').$type<readonly string[] | null>(),
    explanationMd: text('explanation_md').notNull(),
    /**
     * A short, task-specific nudge shown before an attempt exists (same
     * visibility as `conditionMd`, never the answer) — points at the
     * right method (ОДЗ, a theorem, what to read off a graph) without
     * giving away the solution. Null for tasks that don't have one yet
     * (never a generic fallback — see apps/web's toSampleTask).
     */
    hintMd: text('hint_md'),
    /**
     * The same content as `explanationMd`, broken into named steps for
     * a step-by-step UI — titles are per-task ("ОДЗ", "Считываем данные
     * с графика", "Теорема Пифагора", ...), never a fixed template.
     * Only sent alongside `explanationMd` (post-attempt). Null falls
     * back to rendering `explanationMd` as one block.
     */
    solutionSteps: jsonb('solution_steps').$type<
      readonly { title: string; explanation: string }[] | null
    >(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    sourceYear: integer('source_year'),
    /**
     * S3 import provenance (docs/imports/ege-2026-variant-1-manifest.json)
     * — which document/variant/page a task was transcribed from, kept
     * separately from `source` (a short display label like "ФИПИ" or a
     * publisher name) so audits can trace a task back to its exact page.
     * Null for hand-seeded/demo tasks that predate the import pipeline.
     */
    sourceDocument: text('source_document'),
    sourceVariant: integer('source_variant'),
    sourcePage: integer('source_page'),
    /**
     * The condition exactly as transcribed from the source before any
     * normalization/LaTeX cleanup — kept so a reviewer can always compare
     * `conditionMd` back against what the document actually said.
     */
    rawStatement: text('raw_statement'),
    /** Dedup fingerprint: hash(subjectId + taskNumber + normalized statement). */
    contentHash: text('content_hash'),
    tags: jsonb('tags').$type<readonly string[]>().notNull().default([]),
    status: text('status', { enum: taskStatuses }).notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_subject_number_idx').on(table.subjectId, table.taskNumber),
    index('tasks_status_idx').on(table.status),
    uniqueIndex('tasks_content_hash_idx').on(table.contentHash),
  ],
);

/**
 * S3.2 content model (docs/PRODUCTION_DATA_MODEL.md): a `Task` stays a
 * single row owned by `subjects`/`topics` as before; `collections` and
 * `variants` are a separate membership layer on top via `variantTasks`
 * — a task never gets duplicated to appear in a collection/variant, a
 * full exam variant, and the "по заданиям" number filter at once.
 * `draft`/`archived` mirror `tasks.status` but there is no
 * `needs_review` here — review happens per-task, not per-collection.
 */
export const contentStatuses = ['draft', 'published', 'archived'] as const;

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** Display label for the publisher/author, e.g. "Ященко". Never baked into a Task row directly. */
    publisher: text('publisher'),
    year: integer('year'),
    description: text('description'),
    status: text('status', { enum: contentStatuses }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('collections_slug_idx').on(table.slug)],
);

export const variants = pgTable(
  'variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id),
    variantNumber: integer('variant_number').notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    status: text('status', { enum: contentStatuses }).notNull().default('published'),
    sourceFile: text('source_file'),
    sourcePageStart: integer('source_page_start'),
    sourcePageEnd: integer('source_page_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('variants_collection_number_idx').on(table.collectionId, table.variantNumber),
  ],
);

/**
 * Task <-> Variant membership, many-to-many in shape even though today
 * every task belongs to exactly one variant: the same Task row (found
 * by dedup fingerprint, `tasks.contentHash`) can later gain a second
 * `variantTasks` row for a different variant without ever being
 * copied. `position` is the task's 1-based order within that variant's
 * full exam (never touched by shuffle — see modules/tasks). Listing
 * "every task in a collection" joins this table to `variants` and
 * filters by `collectionId`, rather than adding a separate
 * `collection_tasks` table that would just duplicate this membership.
 */
export const variantTasks = pgTable(
  'variant_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('variant_tasks_variant_task_idx').on(table.variantId, table.taskId),
    index('variant_tasks_variant_position_idx').on(table.variantId, table.position),
    index('variant_tasks_task_idx').on(table.taskId),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    answerRaw: text('answer_raw').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    timeSpentMs: integer('time_spent_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('attempts_user_task_idx').on(table.userId, table.taskId),
    index('attempts_task_idx').on(table.taskId),
  ],
);

export const mistakeStatuses = ['open', 'resolved'] as const;

/**
 * One row per (user, task) ever answered wrong — never deleted, only
 * updated. `timesWrong` and `firstAttemptId` are the permanent history;
 * `status` flips to 'resolved' on a later correct attempt and back to
 * 'open' if the user gets it wrong again, per CLAUDE.md's "Мои ошибки"
 * spec (a real training mode, not just a log).
 */
export const mistakes = pgTable(
  'mistakes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    firstAttemptId: uuid('first_attempt_id')
      .notNull()
      .references(() => attempts.id),
    lastAttemptId: uuid('last_attempt_id')
      .notNull()
      .references(() => attempts.id),
    timesWrong: integer('times_wrong').notNull().default(1),
    status: text('status', { enum: mistakeStatuses }).notNull().default('open'),
    /**
     * For 'multi_part' tasks only: ids of the parts that were wrong on
     * the last attempt (e.g. ["b"]), so a future adaptive engine can
     * tell "wrong on part б" from "wrong on the whole task" instead of
     * only knowing the task as a whole was missed. Null for every other
     * answer type.
     */
    wrongParts: jsonb('wrong_parts').$type<readonly string[] | null>(),
    explanationOpened: boolean('explanation_opened').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('mistakes_user_task_idx').on(table.userId, table.taskId)],
);

/**
 * A user's saved tasks ("В избранное" bookmark on the Task screen) —
 * the (userId, taskId) unique index is what makes toggling idempotent
 * from the client (add is a plain insert that 409s on a duplicate,
 * remove is a plain delete) without a read-then-write race. Keyed by
 * the same anonymous `userId` every other per-user table uses (see
 * apps/api/src/plugins/anonUser.ts) — no separate identity system.
 */
export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('favorites_user_task_idx').on(table.userId, table.taskId)],
);

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 2 — the foundational TASK ↔
 * SKILL taxonomy. No ML/AI anywhere in this system: skills are seeded
 * deterministically from each task's own authored `methodTags` (see
 * `packages/shared/src/solutionTemplates/**`'s `CanonicalSolution.methodTags`
 * and `apps/api/src/modules/skills/sync.ts`), never inferred or
 * generated. A skill always belongs to one subject — reuses the
 * existing `subjects` table, never a per-subject skills table.
 */
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('skills_subject_slug_idx').on(table.subjectId, table.slug)],
);

/**
 * 'canonical' = derived from a task's own authored canonical-solution
 * `methodTags` (the only source populated so far). 'admin'/'import' are
 * reserved for a future manual-tagging or bulk-import path — not used
 * yet, never a stand-in for an AI/ML classifier.
 */
export const taskSkillSources = ['canonical', 'admin', 'import'] as const;

export const taskSkills = pgTable(
  'task_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    source: text('source', { enum: taskSkillSources }).notNull().default('canonical'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('task_skills_task_skill_idx').on(table.taskId, table.skillId)],
);

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 3 — one row per (user, skill),
 * fully recomputed from that user's real `attempts` on every linked
 * task every time it's written (never an incremental counter) — see
 * `apps/api/src/modules/learning/{mastery,repo,service}.ts`. No AI/ML:
 * `mastery`/`confidence` are a deterministic formula over
 * attempts/correctAttempts and a recency window, documented and unit
 * tested in `packages/shared/src/learning/mastery.ts`. Both are stored
 * 0..100 (never mixed with a 0..1 scale) so every consumer reads the
 * same range.
 */
export const userSkillStatistics = pgTable(
  'user_skill_statistics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    attempts: integer('attempts').notNull().default(0),
    correctAttempts: integer('correct_attempts').notNull().default(0),
    incorrectAttempts: integer('incorrect_attempts').notNull().default(0),
    /** 0..100. See `calculateSkillMastery` for the exact formula. */
    mastery: integer('mastery').notNull().default(0),
    /** 0..100 — how much data backs `mastery`, not how good the user is. */
    confidence: integer('confidence').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_skill_statistics_user_skill_idx').on(table.userId, table.skillId),
    index('user_skill_statistics_skill_idx').on(table.skillId),
  ],
);

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 4 — one row per task, the
 * task's *observed* statistical difficulty from real `attempts`
 * (never user-specific — contrast with `user_skill_statistics` above).
 * Deliberately separate from `tasks.difficulty` (the author's 1..3
 * editorial rating, set at import time, e.g.
 * `importEge2026Variant1.ts`'s `difficultyForTaskNumber`) — this table
 * never overwrites or reads that column; the two can agree or disagree
 * and both stay visible. `accuracy`/`difficulty` are null with 0
 * `attempts` (cold start — no observed difficulty yet, never a
 * fabricated 50), `confidence` is always 0..100. See
 * `calculateTaskDifficulty` for the exact formula.
 */
export const taskStatistics = pgTable(
  'task_statistics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    attempts: integer('attempts').notNull().default(0),
    correctAttempts: integer('correct_attempts').notNull().default(0),
    incorrectAttempts: integer('incorrect_attempts').notNull().default(0),
    /** 0..100, null until the first attempt (cold start). */
    accuracy: integer('accuracy'),
    /** 0..100, null until the first attempt (cold start). Confidence-adjusted — see `calculateTaskDifficulty`. */
    difficulty: integer('difficulty'),
    /** 0..100 — how much evidence backs `difficulty`/`accuracy`, not how hard the task is. Always set, even at 0 attempts (confidence 0). */
    confidence: integer('confidence').notNull().default(0),
    /** Informational only — never a factor in `difficulty` itself (see formula doc). Null when no attempt recorded a time. */
    averageTimeMs: integer('average_time_ms'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('task_statistics_task_idx').on(table.taskId)],
);

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 5 — per-user error-signature
 * counts. No AI/ML: `errorSignature` is one of the fixed, deterministic
 * codes `detectErrorSignatures` produces (see
 * `packages/shared/src/learning/errorSignatures.ts`) — a plain text
 * enum value, not a foreign key into a separate catalog table, since
 * the set of possible codes is small and hardcoded, exactly like
 * `taskSkillSources` above (no second dictionary table for a fixed
 * enum). A `multi_part` per-part signature is encoded as
 * `"<type>:<partId>"` (e.g. `"part_incorrect:b"`) directly in this
 * column, rather than adding a separate nullable `partId` column.
 *
 * Unlike `user_skill_statistics`/`task_statistics` (Phase 3/4, which
 * recompute a nonlinear formula from the FULL attempt history on every
 * write), this table is a plain running count: `count` is incremented
 * by exactly 1 per detected occurrence, which is mathematically
 * identical to recomputing a fresh count from scratch — so a per-attempt
 * increment and `rebuildUserErrorStatistics`'s full replay of history
 * always converge to the same totals.
 */
export const userErrorStatistics = pgTable(
  'user_error_statistics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    errorSignature: text('error_signature').notNull(),
    count: integer('count').notNull().default(0),
    lastOccurredAt: timestamp('last_occurred_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_error_statistics_user_signature_idx').on(table.userId, table.errorSignature),
  ],
);

/**
 * Self-reported level, NOT a real measured result (ZUBRILKA LEARNING
 * INTELLIGENCE audit, Phase 1 vertical slice) — what the user says about
 * themselves during onboarding, distinct from any future estimated/observed
 * score. 'unknown' is a valid, non-error answer (diagnostic-triggering UX
 * is a later phase).
 */
export const selfReportedScoreLevels = [
  'unknown',
  'under_40',
  '40_plus',
  '50_plus',
  '60_plus',
  '70_plus',
  '80_plus',
  '90_plus',
] as const;

/** What score the user wants to reach for this subject — kept separate from `selfReportedScore`. */
export const targetScoreLevels = [
  'unknown',
  '60_plus',
  '70_plus',
  '80_plus',
  '90_plus',
  '95_plus',
  '100',
] as const;

/**
 * One row per (user, subject) the user picked during onboarding — the
 * first real Learning Intelligence table (Phase 1 vertical slice only;
 * see docs' Learning Intelligence audit for what's intentionally NOT here
 * yet: estimated/observed score, mastery, confidence, diagnostics,
 * cohort, errors). `onboardingCompletedAt` is set only after every
 * selected subject for that user has been saved in the same request —
 * never left in a state where the UI thinks onboarding finished but a
 * row is missing (see modules/learningProfile/service.ts).
 */
export const userSubjectProfiles = pgTable(
  'user_subject_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    targetScore: text('target_score', { enum: targetScoreLevels }).notNull().default('unknown'),
    selfReportedScore: text('self_reported_score', { enum: selfReportedScoreLevels })
      .notNull()
      .default('unknown'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_subject_profiles_user_subject_idx').on(table.userId, table.subjectId),
  ],
);

export const learningSessionStatuses = ['active', 'completed'] as const;

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 9 — session BOOKKEEPING only:
 * which tasks a learning session has already served, in what order,
 * and whether it's finished. This is deliberately NOT a second source
 * of truth for learning state: it never writes to `attempts`,
 * `mistakes`, `user_skill_statistics`, `task_statistics`, or
 * `user_error_statistics` — those remain exactly as the existing
 * attempt-submission transaction updates them. `consumedTaskIds` exists
 * purely so a session can hard-exclude tasks it already showed (see
 * `modules/learning/learningPath/service.ts`'s `excludeTaskIds`); the
 * actual next-task scoring always re-reads fresh mastery/error/
 * difficulty data from those authoritative tables, never a cached
 * value here. A small table was chosen over a signed stateless token
 * because the project has no existing token-signing infrastructure
 * and inventing one was explicitly out of scope — see Phase 9's
 * architecture notes.
 */
export const learningSessions = pgTable(
  'learning_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    /** Requested session length (1..10), validated at creation — fixed for the life of the session. */
    total: integer('total').notNull(),
    /** Every task this session has served, in serve order — never
     * contains a task twice. Its length IS the session's current
     * position; no separate position column to keep in sync. */
    consumedTaskIds: jsonb('consumed_task_ids').$type<readonly string[]>().notNull().default([]),
    /** Smart Training's 🔄 "Только нерешённые" — persisted so every
     * `next` step (which re-calls `getLearningPath` fresh) applies the
     * same filter the session was started with, not just its first task. */
    unseenOnly: boolean('unseen_only').notNull().default(false),
    /** Smart Training's 🎲 "Случайное" — same persistence reason as
     * `unseenOnly` above. */
    randomizeTopTier: boolean('randomize_top_tier').notNull().default(false),
    /** Non-null marks this a VARIANT session (Training's "Вариант"
     * mode solving one real numbered exam variant start-to-finish),
     * never a Smart Training session — the two modes share this one
     * table's bookkeeping shape (consumedTaskIds/status/started-
     * /completedAt) rather than a parallel entity, but never mix:
     * `plannedTaskIds` is also non-null exactly when this is. */
    variantId: uuid('variant_id').references(() => variants.id),
    /** The variant's own real, published tasks in exam order — fixed
     * for the life of the session. A variant session's `next` step
     * serves `plannedTaskIds[consumedTaskIds.length]` directly (no
     * `getLearningPath` scoring at all: the order is the real exam's
     * own, not a recommendation) instead of Smart Training's scored
     * selection. Null for every Smart Training session. */
    plannedTaskIds: jsonb('planned_task_ids').$type<readonly string[]>(),
    status: text('status', { enum: learningSessionStatuses }).notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once, the moment `status` flips to 'completed'. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('learning_sessions_user_idx').on(table.userId)],
);

/**
 * Streak system — one real row per (user, Europe/Moscow calendar day)
 * the user submitted at least one real task attempt (correct or not —
 * finishing the attempt is what counts, never just opening/viewing a
 * task). The `date` mode stores a pure calendar day with no time/zone
 * component; the service layer is the single place that resolves an
 * attempt's UTC `createdAt` to its Moscow calendar date before writing
 * here — this table itself holds no timezone logic.
 *
 * `UNIQUE(user_id, activity_date)` is the whole mechanism for both of
 * the two invariants the project asked for: several attempts in one
 * Moscow day only ever produce one row (an `ON CONFLICT DO NOTHING`
 * upsert — see `recordDailyActivity`), and two concurrent submissions
 * on the same day can't race into two rows (the unique constraint is
 * enforced by Postgres itself, not application-level locking).
 *
 * The current streak is NOT stored as a separate counter on this table
 * or on `users` — it's computed on demand from these rows (today's
 * Moscow date walking backward through consecutive days), the same
 * "deterministic, on-demand, never a second place to drift out of
 * sync" precedent `taskSimilarity` already set for this codebase.
 */
export const userDailyActivity = pgTable(
  'user_daily_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Europe/Moscow calendar date (YYYY-MM-DD), resolved server-side
     * from the attempt's real `createdAt` — never the client's own
     * timezone or clock. */
    activityDate: date('activity_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_daily_activity_user_date_idx').on(table.userId, table.activityDate),
  ],
);
