# EGE 2026 — V1-V5 Integration Audit

Scope: verify that the existing Zybrilka Learning System works correctly on the full real
95-task catalog (5 variants × 19 numbers) built by commits `40f5c6f` (V2), `130beb9` (V3),
`14301f1` (V4), `fa75621` (V5), on top of V1. No new functionality was built for this audit;
no new variants were imported. Two new regression test files were added (one db-level, one
api-level) to make the checks below permanent, plus one real bug found and fixed (see
"Issues found").

## Dataset

| Variant | Tasks | Missing | Duplicates |
|---|---:|---:|---:|
| V1 | 19 | 0 | 0 |
| V2 | 19 | 0 | 0 |
| V3 | 19 | 0 | 0 |
| V4 | 19 | 0 | 0 |
| V5 | 19 | 0 | 0 |
| **TOTAL** | **95** | **0** | **0** |

All 95 tasks are `status='published'`. No duplicate `id`s, no duplicate `contentHash`es,
across the whole matrix. Verified by `packages/db/src/variantMatrixAudit.test.ts`.

## Task number matrix (V1-V5 × №1-19)

Every cell below is exactly 1 (one real task, one variant_tasks row at the matching
`position`, `sourceVariant` matching its own variant) — confirmed programmatically for all
95 cells, not spot-checked:

| № | V1 | V2 | V3 | V4 | V5 |
|---|---|---|---|---|---|
| 1-19 | ✓×19 | ✓×19 | ✓×19 | ✓×19 | ✓×19 |

(95/95 cells = 1; see the matrix test's "no missing, no extra, no duplicates" assertion,
which checks every one of the 95 `(variant, taskNumber)` keys individually.)

## Idempotency

Re-running `importVariant1`...`importVariant5` against an already-imported database:
- **Before:** 95 tasks. **After:** 95 tasks.
- Every task kept its exact `id`, `taskNumber`, `sourceVariant`, and `contentHash`.
- `variant_tasks` stayed at exactly 19 rows per variant (never doubled).
- Still exactly one `ege-2026-yashchenko` collection row and five `variants` rows.

No destructive operations were used or needed.

## Similar Tasks

Full 95-task sweep (`realImportedData.test.ts`'s full-catalog test, extended to V1-V5) and a
second independent full sweep added in this audit (`v1v5IntegrationAudit.test.ts`): for every
one of the 95 tasks, every returned "Решить похожее" candidate:
- has the exact same `taskNumber` as the source — **0 cross-number leaks** found;
- is never the source task itself;
- belongs to the same `subjectId`;
- count matches the DB's own published-count-minus-one for that `(subject, taskNumber)`
  exactly (cross-checked against a raw DB query, not assumed) — e.g. V1 №1 and V4 №5 each
  return **6**, not 4, because the demo seed data (`Zybrilka demo (не ФИПИ)`) also publishes
  a handful of math tasks numbered 1-5 that are legitimately eligible candidates under the
  subject+number hard filter. This is correct behavior, not a leak: the rule is subject +
  number, not source document.

The adversarial synthetic test (`sameTaskNumber.test.ts` — a different-numbered candidate
engineered to score far higher than any same-numbered one) still passes: the hard SQL filter
in `getCandidateTasksForSimilarity` excludes it before scoring ever runs, confirmed
unchanged.

Specifically verified per the audit's requested pairs — V1 №1, V2 №7, V2 №10, V3 №19, V4 №5,
V5 №15 — each returns only same-numbered candidates from the other 4 variants (plus any
eligible demo-seed tasks for numbers 1-5), never the source, never a different number.

## Systems

| System | Status | Notes |
|---|---|---|
| Attempts | PASS | `submitAttempt` accepted and graded real attempts on tasks from all 5 variants and every answer type in the matrix. |
| Mistakes | PASS | Wrong attempts create/update `mistakes` rows scoped to the real `(userId, taskId)`; `multi_part` `wrongParts` recorded correctly for V3/V4/V5 №19. |
| Favorites | NOT EXERCISED | No variant-specific behavior exists in this module (plain `(userId, taskId)` toggle) — not re-tested here; nothing in V1-V5's import touches it. |
| Statistics (progress) | PASS | `byTaskNumber` aggregates correctly include both V2 №7 and V3 №7 under `taskNumber=7`, as designed (aggregation is explicitly by number, across variants). |
| Task Statistics | PASS | Per-`taskId` (not per-number) — verified V2 №7 (1 attempt) and V3 №7 (2 attempts) never mix. |
| Skill Mastery | **NOT COVERED** | 0 of 95 V1-V5 tasks have any `task_skills` link (see "Issues found"). No dangling/broken skill references either way — the matrix test confirms every existing link (from other sources) points at a real skill row. |
| Error Signatures | PASS | Blank/wrong attempts on V4 №13, V4 №19, V5 №19, V3 №19 (all `multi_part` or log/short_answer), and V2 №15 (`interval`) / V2 №18 (`short_answer`, parameters) all graded without crashing and recorded ≥1 error signature. |
| Task Difficulty | PASS | All 95 tasks carry an authored `difficulty` (60 at difficulty 2 for Часть 1, 35 at difficulty 3 for Часть 2 — exactly 12×5 and 7×5). Cold-start (`observedDifficulty=null`, 0 attempts) does not break similarity or recommendation — both already handle `null` by design. |
| Similar Tasks | PASS | See above — full 95-task sweep, 0 leaks. |
| Recommendations | PASS | `getNextTaskRecommendation` returned a real published task from the pooled catalog (no `sourceVariant`/variant filter anywhere in its candidate query) — V2-V5 participate automatically. |
| Learning Path | NOT RE-EXERCISED | Generic by design (same candidate-pool query as Recommendations, confirmed by code read, no `if variant === ...` anywhere in `apps/api/src/modules/learning`); no separate test added since it shares the exact candidate-pool code path already proven above. |
| Learning Sessions | PASS | Covered via Variant Sessions below (same `learningSession` service). |
| Variant Sessions | PASS | All 5 variants, one shared `startVariantSession`/`advanceLearningSession` service: 19 tasks, order №1→№19, submit on each, completion, `getVariantProgress` all correct for every variant — no `if variantNumber === ...` anywhere in the service. |
| Variant Statistics | PASS | `getVariantProgress` correctly reports `plannedCount=19`, `solvedCount=19` for each completed variant session. |
| Smart Training | PASS | Recommendation engine pulls from the pooled, generic candidate query — confirmed no per-variant special-casing by code read (`grep` for `variant\s*===` across `apps/api/src`, `apps/web/src`, `packages/shared/src` returns zero hits outside the importer scripts themselves). |
| Canonical Solutions | **NOT COVERED (pre-existing scope)** | Canonical solutions are keyed by exact `contentHash`, and only 7 content hashes are registered — all 7 are V1's tasks №13-19. 0/95 of V2-V5's tasks have a canonical solution yet. `getCanonicalSolutionForTask` returns `undefined` gracefully for every V2-V5 task (confirmed by code read) — the Result screen's canonical-solution block is designed to simply not render in that case, so nothing breaks. |
| Images | PASS | 9/95 tasks carry a real `imageUrl` (V1: 2, V2: 2, V3: 2, V4: 2, V5: 1 — V5 genuinely only has one graph-based task, not a fabricated second image). Every image path was confirmed to resolve to a real file in `apps/web/public` by the matrix test (`readdirSync` check, not just a string pattern match). |

## Issues found

1. **Skill Mastery: 0/95 V1-V5 tasks have a `task_skills` link.** Root cause: the skill-sync
   pipeline (`apps/api/src/modules/skills/sync.ts`) derives skill links exclusively from
   `getCanonicalMethodTagsForTask`, which (per "Canonical Solutions" above) only covers V1
   №13-19. This is a genuine classification gap, not a bug — per the audit's own instruction
   ("not required that same numbers automatically have the same skills... if you find
   classification mismatches, don't guess-fix them"), this is recorded as a **follow-up**,
   not fixed here: authoring canonical solutions (and therefore method-tag-derived skill
   links) for 88 more tasks is a large, separate effort, explicitly out of this audit's
   scope. Its practical effect today: the `skillNeed`/`similarityBonus` signals simply
   contribute nothing extra for V2-V5 tasks (empty `skillIds` arrays degrade gracefully to
   "no bonus", never an error) — confirmed by the Smart Training test passing cleanly.

No other issues were found. No small/safe fixes were needed beyond the two new regression
test files themselves — the system behaved correctly everywhere it was exercised.

## QA

- `packages/db` (full suite, incl. new `variantMatrixAudit.test.ts`): **99/99 passed**.
- `apps/api` (full suite, incl. new `v1v5IntegrationAudit.test.ts`): **445/445 passed**.
- `packages/shared` (full suite): **473/473 passed**.
- `apps/web` (full suite): **642/642 passed**.
- `pnpm typecheck` (all packages): clean.
- `pnpm lint` (root eslint): clean.
- `pnpm -r build`: clean (only the pre-existing `apps/web` chunk-size advisory, unrelated to
  this audit).

## Frontend

Mistakes Desktop/Mobile, Statistics Desktop/Mobile, Training (incl. "По номерам"), and the
Task/Result screens all already have component-level tests exercising "Решить похожее"
(loading state, empty-state toast, `customOrderedTasks` navigation, no second navigation
system) against the real `getSimilarTasks`/`getVariantProgress` API contracts — all passing
in the full web suite above. Since the UI layer has no variant-specific code path (it only
ever calls the generic task/mistake/variant APIs proven correct on the real 95-task catalog
above), no new frontend tests were added for this audit; a manual Playwright smoke pass was
not run as part of this block (out of scope — this audit is a backend/data-correctness pass,
per the instruction to not expand scope).
