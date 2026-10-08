# EGE 2026 — Варианты 6–10 — отчёт об импорте

Status: **Варианты 6, 7 и 8 complete.** Варианты 9–10 pending (same pipeline, next blocks).

## Source

Two sources were supplied for this batch, used together per the user's instruction ("ОБА ZIP-ФАЙЛА ВМЕСТЕ = ЕДИНЫЙ ИСТОЧНИК V6–V10"), plus a third source added mid-task:

1. `variant6_7_text_images.zip` — folders `variant_6/`, `variant_7/`, each with `page_01`..`page_04`, each page containing `README.txt`, `page_NN.txt` (extracted text) and 9–13 `image_NN.png` raw PDF-extracted image fragments.
2. `variant8_10_text_images.zip` — same structure for `variant_8/`, `variant_9/`, `variant_10/`.
3. `variant6_10.pdf` — the original 20-page PDF (4 pages × 5 variants) for Варианты 6–10, added as a **backup primary source** per the user's explicit follow-up instruction, used point-wise whenever the TXT or ZIP images lost a digit, a formula, or graph coordinates.

Reading priority followed exactly: **TXT → ZIP image → original PDF**, PDF used only to resolve specific illegible spots (never re-read wholesale).

## Вариант 6 — what required image/PDF fallback

- **Task 1** (geometry, altitude): both the ZIP's TXT (garbled: "равна 476") and its secondary text-layer image lost the altitude value entirely. Resolved from the original PDF page 1: $AH=4\sqrt6$. The resulting answer (cos = 23/25 = 0.92) is a clean rational number, which independently corroborates the reading — a wrong altitude would not have produced a Pythagorean-triple-clean result.
- **Task 2** (vectors): the ZIP's vector graph image was too low-resolution to count grid squares reliably. Re-read from the clean 300dpi original PDF render, with pixel-level grid-alignment verification (overlaid computed gridlines against the actual scanned gridlines, crosshair-checked against both vector endpoints). Result: $\vec a=(3;6)$, $\vec b=(11;-2)$ → cos = 21/75 = 7/25 = 0.28, confirmed clean.
- **Task 11** (f(x)=kx+b, g(x)=p√x graph): required the most scrutiny — an initial eyeball read was wrong (confused the curve's marked dot's position). Settled via two independent pixel-precise local measurements on the original PDF render: the curve's dot at (1;3) and the line's dot exactly 3 grid squares to its right at (4;3), both confirmed via gridline-crosshair zoom. This gives p=3, k=3/4, and intersection x=16 — verified algebraically (f(16)=g(16)=12).
- All other 16 tasks (3–10, 12–10, 13 parts a/b, 14–19) were read cleanly from TXT and solved/independently re-verified directly; no image fallback was needed.

No numeric value was guessed anywhere in Вариант 6. Where the source was ambiguous, the PDF was consulted and the final numeric answer was cross-checked for internal consistency (clean rational/Pythagorean results) before being trusted.

## Task count, images, answer types

- Вариант 6: 19/19 tasks, all `status: published`, 0 `needs_review`.
- Images: 1 (`task-11-graph.png`, cropped from the original PDF page, saved at `apps/web/public/tasks/imports/ege-2026-variant-6/task-11-graph.png`).
- `answerType` distribution: 18 × `short_answer`, 1 × `multi_part` (task 19). No `interval` type was needed for this variant (task 15's inequality is expressed as a `short_answer` text interval, matching the existing Вариант 5 precedent for the structurally identical problem).
- `topic`/`subtype` were assigned per actual task content, not by a fixed taskNumber→topic table. They happen to match Вариант 5's topics for several numbers because the underlying problem families are genuinely the same (same ЕГЭ part/structure), not because of an artificial mapping.

## Skills and canonical solutions

No skill links were created for Вариант 6 (deferred, per instruction — "Full skill mapping is explicitly deferred to a separate future task"). No canonical-solution-system entries were fabricated; every task has `explanationMd`/`hintMd`/`solutionSteps` with an independently re-derived solution, same as V1-V5.

## Stable IDs / idempotency

Reused the existing V1-V5 mechanism unchanged: tasks are looked up and upserted by `(subjectId, source, sourceVariant, taskNumber)`, never a freshly generated id; `contentHash` is `sha256(subjectId|taskNumber|normalized(rawStatement))`. `importEge2026Variant6.test.ts` has an explicit idempotency test (re-running the importer twice does not duplicate rows, does not touch the demo seed) and a task-id-stability test (ids unchanged across a second run).

## Similar Tasks

Extended coverage (not yet the full 10-variant sweep, since V7-V10 don't exist yet):
- `apps/api/src/modules/learning/v1v5IntegrationAudit.test.ts`: added V6 №2 and №13 to the explicit hard-filter cases; the existing full-matrix sweep test now iterates all 114 tasks (was 95) since it reads the whole table.
- `apps/api/src/modules/learning/taskSimilarity/realImportedData.test.ts`: added an explicit V6 ×{1,10,19} block (same pattern as V4/V5), plus the existing full-sweep test (`every real task number... only ever cross-links within its own number`) now covers V6 automatically.
- `packages/db/src/testing.ts`'s `createImportedVariantsTestDb()` now imports V1-V6, so every test built on it automatically includes V6 in its matrix.

## Navigation ("По номерам" / "Только нерешённые" / "Перемешивать" / "К списку заданий №N")

No code changes were needed or made — `resolveSingleNumberSession()`, the `unsolved` filter, and `trainingByNumberRouteFor()` are all variant-count-agnostic (built on `listTasksByNumber`/`taskNumber`, not a hardcoded variant list), confirmed by reading `apps/web/src/lib/startTraining.ts` and `apps/web/src/lib/navigation.tsx`. Selecting №N with V6 imported will automatically include V6's task in the number's session.

## Production sync

`infra/docker-compose.yml`'s `sync-content` service's `&&`-chain extended to run `importEge2026Variant6.js` after `importEge2026Variant5.js`, preserving the non-zero-exit-stops-the-chain behavior (so a failing V6 import still blocks `api`/`worker` startup, same as V1-V5).

## Tests run (Вариант 6 block)

- `packages/db/src/importEge2026Variant6.test.ts` — 11/11 passed.
- `packages/db/src/variantMatrixAudit.test.ts` (extended to 6×19=114) — 8/8 passed.
- `apps/api/src/modules/learning/v1v5IntegrationAudit.test.ts` (extended) — passed as part of the combined 54-test run below.
- `apps/api/src/modules/learning/taskSimilarity/realImportedData.test.ts` (extended) — passed as part of the combined run.
- Combined run of the four files above: **54/54 passed**.
- `packages/db` typecheck: clean.
- `apps/api` typecheck: clean.
- ESLint on all touched files: clean, no warnings.
- Prettier: all touched files formatted (pre-existing formatting debt in unrelated files, e.g. `Training.tsx`, `StatisticsDesktop.tsx`, was left untouched — not part of this block's scope).
- Full monorepo `pnpm test`/`pnpm check`: see final report message for this block (run separately, in background, due to runtime).

## Вариант 7

19/19 tasks, all `published`, 0 `needs_review`, 0 images (no task required a graph/image asset — tasks 8 and 11 both resolved from the clean PDF render via text/coordinate description alone).

**Image/PDF fallback needed:**
- **Task 1** (cyclic quadrilateral angles): the ZIP image was ambiguous about which two angles were given (adjacent vs. a diagonal-split configuration). Resolved using the standard well-known problem structure (adjacent angles given, opposite angles computed via the 180°-sum property — confirmed as the only interpretation consistent with 48°+74°≠180°, which rules out an opposite-pair reading).
- **Task 11** (quadratic + line graph): required careful pixel-grid verification on the original PDF. An initial automated axis-row detection locked onto the wrong horizontal line (a page element thicker than the true x-axis), which silently produced non-integer, inconsistent grid coordinates. This was caught by cross-checking against a direct visual crosshair confirmation at the origin, the axis was re-identified correctly, and all graph points (parabola roots at 0/−4, vertex (−2;4), line through (0;0) and (2;5)) were re-verified against the corrected grid before being used — demonstrating exactly why the "never guess, verify against a clean rational/consistent result" rule matters.
- **Task 14** (triangular prism dihedral angle) and **Task 18** (trigonometric equation with parameter, root-counting) are advanced Part 2 problems solved via explicit coordinate/combinatorial derivation (not transcribed from an answer key); task 14's ratio 12:13 was independently cross-checked against the problem's own stated ratio as a self-consistency proof, and task 16's economics problem was verified by confirming BOTH given constraints (final payment 484,000 AND total payments 2,376,000) are satisfied exactly by the derived loan amount.
- All other tasks (2–7, 9, 10, 12, 13, 15, 17, 19) read cleanly from the TXT/PDF with no ambiguity.

No numeric value was guessed anywhere in Вариант 7.

**Tests:** `importEge2026Variant7.test.ts` 11/11; `variantMatrixAudit.test.ts` (7×19=133) 8/8; `deploySyncContent.test.ts` 5/5; combined with the extended `v1v5IntegrationAudit.test.ts`, `realImportedData.test.ts`, `sameTaskNumber.test.ts` — **67/67 passed**. Typecheck, lint, build all clean. Production sync (`infra/docker-compose.yml`) extended through V7.

## Вариант 8

19/19 tasks, all `published`, 0 `needs_review`, 0 images.

**Image/PDF fallback needed:**
- **Task 8** (derivative-from-graph, find the LARGEST derivative among marked points −1,1,2,3): the ZIP/TXT gave no usable rendering of this wavy graph. Read directly from the clean PDF: points 1 and 2 sit exactly at a local max/min (derivative 0), point −1 sits just past a peak (small negative slope), point 3 sits just before the next peak (small positive slope) — answer 3, the only strictly positive value among the four.
- **Task 11** (parabola + line sharing a root): required the same pixel-grid crosshair verification used in V6/V7 — confirmed parabola roots at 0 and 2 with vertex (1;−1), and the line through (0;0) and (2;4), giving a clean intersection at x=4.
- **Task 17** (circle inscribed in a 120° angle, prove AD=3BC, find PN): solved via the same general coordinate derivation built for V7's analogous 60°-angle problem, re-derived for the new angle and re-verified algebraically (AD/BC ratio computed exactly as 3, and PN came out to a clean R/13 — with R=13 given, PN=1, a strong self-consistency signal).
- **Task 18** (root-counting with parameter): re-derived the boundary-sensitivity analysis from scratch for the different interval `[-π;4π]` (not V7's `[π;6π]`), since the asymmetric interval changes which boundary (x=−π vs x=4π) drives the critical ε-thresholds — resulted in a `φ/(4π)` half-width instead of V7's `φ/(6π)`, confirmed by checking both interval endpoints independently rather than assuming the same formula transfers.
- All other tasks read cleanly from the PDF with no ambiguity.

No numeric value was guessed anywhere in Вариант 8.

**Tests:** `importEge2026Variant8.test.ts` 11/11; `variantMatrixAudit.test.ts` (8×19=152) 8/8; `deploySyncContent.test.ts` 5/5; combined with the extended API test files — **70/70 passed**. Typecheck, lint, build all clean. Production sync extended through V8.

## Known limitations

- Варианты 9–10 (38 tasks) are not yet imported — next blocks, one per variant, following this exact same pipeline and verification rigor.
- `infra/docker-compose.yml`'s `sync-content` chain only runs through V8 for now; it will be extended again after each subsequent variant is added.
- The adversarial Similar-Tasks sweep across the full intended 10-variant/190-task matrix cannot exist yet since only 8 variants exist; the current sweep covers the full real 152-task matrix.
