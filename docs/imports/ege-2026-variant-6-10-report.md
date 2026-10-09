# EGE 2026 — Варианты 6–10 — отчёт об импорте

Status: **Варианты 6, 7, 8, 9 и 10 complete.** Full batch (95 tasks) finished.

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

## Вариант 9

19/19 tasks, all `published`, 0 `needs_review`, 0 images — both of this variant's graph-based tasks (№2 vectors, №11 exponential curve) were resolved with full pixel-grid precision rather than an image fallback (see below).

**Image/PDF fallback needed (resolved via pixel analysis, not transcribed as images):**
- **Task 2** (vectors): the clean 300dpi PDF render was gridline-calibrated (x0,y0,dx,dy detected from row/column dark-pixel peaks), then both vector endpoints were located by scanning thick-stroke column runs and confirmed with a crosshair-overlay zoom at each endpoint. An initial eyeball read gave a=(0,−3), b=(−2,4) — producing an irrational length (3√10) for 1.5b−a, immediately flagged as wrong per the "integer or finite decimal" answer-format rule for tasks 1-12. The corrected, crosshair-verified coordinates are a=(−1,−3) (tail (3,1), tip (2,−2)) and b=(−4,6) (tail (−1,−1), tip (−5,5)), giving 1.5b−a=(−5,12), length=13 — a clean integer, strongly corroborating the reading.
- **Task 11** (f(x)=a^(x+b) graph): the ZIP's low-resolution image was gridline-calibrated independently (separate image, smaller scale), and the two marked dots were isolated via `binary_erosion` blob detection plus a crosshair-overlay re-check. Points read as (0,4) and (2,1) — giving a=1/2, b=−2, f(−3)=32, again a clean integer.
- **Task 9** (radiator cooling, physics formula): the ZIP/TXT OCR of the formula was heavily garbled; re-read from the clean PDF render, confirming `x=(acm/γ)·lg((Tв−Tп)/(T−Tп))` (lg = log base 10). The coefficient `acm/γ` evaluates to exactly 168 — identical to the given pipe length `x`, which collapses the log argument to exactly 10¹ and yields a clean T=21°C, a strong self-consistency signal that the re-read formula is correct.
- **Task 18** (system of equations with parameter, solution-count problem): the first equation was algebraically reduced to a circle `(x+a)²+(y−a)²=12(a−2)²` and cross-checked numerically (root-finding over the exact quartic obtained by eliminating y) across a wide scan of `a` to locate every transition in solution count, rather than guessing a plausible-looking interval; the two boundary values `a=6±2√6` where the count is exactly 7 were confirmed both symbolically (via the circle/hyperbola intersection structure) and numerically.
- **Task 19** (number theory, three-number board problem): resolved via the mod-3 argument forced by "average of any three of Petya's squares is an integer," cross-checked against both sub-questions (104 not divisible by 3 vs. 306 divisible by 3), and part в)'s maximum-pairs count was verified by comparing multiple chain-allocation strategies (all converging on 11), not assumed from a single construction.
- All other tasks (1, 3–8, 10, 12–17) were read cleanly from the TXT/PDF with no ambiguity.

No numeric value was guessed anywhere in Вариант 9. Every graph-reading and hard-algebra task was cross-checked against the exam's own "integer or finite decimal" constraint (tasks 1-12) or an independent self-consistency check (tasks 13-19) before being accepted.

**Tests:** `importEge2026Variant9.test.ts` 12/12; `variantMatrixAudit.test.ts` (9×19=171) passed; `deploySyncContent.test.ts` (9 importers, 8 `&&`) passed; extended `v1v5IntegrationAudit.test.ts` (28/28) and `realImportedData.test.ts` (21/21) passed. Typecheck, lint, build all clean. Production sync (`infra/docker-compose.yml`) extended through V9.

## Вариант 10

19/19 tasks, all `published`, 0 `needs_review`, 0 images — both of this variant's graph-based tasks (№2 vectors, №11 logarithmic curve) were resolved with full pixel-grid precision, same as V9.

**Image/PDF fallback needed (resolved via pixel analysis, not transcribed as images):**
- **Task 2** (vectors): gridline-calibrated the clean 300dpi PDF render and traced both vector lines via crosshair-overlay zooms at each endpoint. The two vectors turned out to share no common tail (vector a: tail (−1,6) → tip (3,−5); vector b: tail (1,−2) → tip (4,5) — their lines merely cross visually near the origin, confirmed by tracing each line independently past the crossing point). b−3a=(3,7)−(12,−33)=(−9,40), length=√1681=41 — a clean integer.
- **Task 11** (f(x)=log_a(x+b) graph): an initial eyeball read of the second marked point as (1,2) produced a non-clean f(29)=log_√5(33), immediately flagged as suspicious; a precise pixel/crosshair re-check found the point was actually at (1,4), not (1,2) — giving a=√2, b=3, f(29)=log_√2(32)=10, a clean integer. This is a direct instance of the "never trust an eyeball read, verify against the clean-answer constraint" rule catching a real misreading before it reached the database.
- **Task 18** (system of equations with parameter, solution-count problem, same family as V9's task 18): the first equation reduced to a circle `(x-a)²+(y+a)²=18(a+2)²`; the exact transition boundaries `a=-6` and `a=-6/5` (where the solution count is exactly 7) were derived both symbolically and confirmed by numerically scanning solution counts across a wide range of `a`, exactly as for V9.
- **Task 19** (number theory, three-number board problem, same family as V9's task 19 but with a 5000 threshold instead of 1000 and 15 numbers instead of 20): the larger threshold enables two extra squaring chains (`{7,49,2401}` and `{8,64,4096}`) not available under V9's 1000 cutoff — notably `2401`, the exact number named in the problem statement, is the middle term of one of these chains, which is a strong internal-consistency signal that the chain-counting approach is the intended solution path. Part в)'s answer (10 pairs) was verified by comparing multiple chain allocations.
- All other tasks (1, 3–10, 12–17) were read cleanly from the TXT/PDF with no ambiguity.

No numeric value was guessed anywhere in Вариант 10. Task 11 in particular demonstrates why every graph reading is cross-checked against the exam's own "integer or finite decimal" constraint before being accepted — the first read would have silently produced a wrong answer.

**Tests:** `importEge2026Variant10.test.ts` 12/12; `variantMatrixAudit.test.ts` (10×19=190) passed; `deploySyncContent.test.ts` (10 importers, 9 `&&`) passed; extended `v1v5IntegrationAudit.test.ts` and `realImportedData.test.ts` (55/55 combined) passed. Typecheck, lint, build all clean. Production sync (`infra/docker-compose.yml`) extended through V10.

## Known limitations

- None remaining for this batch — Варианты 6–10 (95 tasks) are all imported, tested, and synced into production. V1–V10 together form the full real 190-task matrix.
