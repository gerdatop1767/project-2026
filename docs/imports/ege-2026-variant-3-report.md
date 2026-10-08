# EGE 2026 — Variant 3

## Source

Same source file as Вариант 2: `ЕГЭ_2026_Ященко_варианты_2-5.pdf` (user-provided ZIP excerpt,
pages 6–21 of the original 36-variant book). Вариант 3 occupies pages 5–8 of this excerpt file
(= pages 10–13 of the original book, confirmed by README.txt bundled with the ZIP and visually by
the "ВАРИАНТ 3" heading on page 5).

- **Subject:** Математика, профильный уровень. **Year:** 2026. **Variant:** 3.

## Pages

Page 5 — задания 1–4. Page 6 — задания 5–10. Page 7 — задания 11–14. Page 8 — задания 15–19.
Часть 1 = 1–12, Часть 2 = 13–19 (same structure as Вариантов 1–2).

## Tasks

| № | Answer | Independent solve | Image | Publish |
|---|---|---|---|---|
| 1 | 14.7 | PASS | — | READY |
| 2 | −32 | PASS | — | READY |
| 3 | 2.5 | PASS | — | READY |
| 4 | 0.16 | PASS | — | READY |
| 5 | 0.2 | PASS | — | READY |
| 6 | 16 | PASS | — | READY |
| 7 | −4.5 | PASS | — | READY |
| 8 | 1.25 | PASS (pixel-calibrated graph read) | YES | READY |
| 9 | 60 | PASS | — | READY |
| 10 | 7 | PASS | — | READY |
| 11 | −2.8 | PASS (pixel-calibrated graph read) | YES | READY |
| 12 | 70 | PASS | — | READY |
| 13 | −2/3 (part б) | PASS | — | READY |
| 14 | 94√5/5 (part б; part а proof verified by coordinates) | PASS | — | READY |
| 15 | x∈(−∞;−4√2−3] ∪ (3;+∞) | PASS | — | READY (`short_answer`, compound bound) |
| 16 | 6 | PASS | — | READY |
| 17 | √7−√2 (part б; part а proof verified by coordinates) | PASS | — | READY |
| 18 | a=2/3, a=1, or a∈[3;+∞) | PASS | — | READY (`short_answer`, compound set) |
| 19 | а) да; б) нет; в) −3330 | PASS (derived necessary bound + construction, numerically cross-checked) | — | READY (`multi_part`) |

### Different task shapes than Вариант 1/2

Several of Вариант 3's tasks follow a genuinely different structure than the corresponding task
number in Вариантов 1–2 (this book varies task *content* per number, not just the numbers):
task 8 is a tangent-line/derivative-value question (not the "count maxima from f′ graph" shape);
task 11 is a hyperbola `k/x+b` reading (not a parabola); task 13 is an exponential equation (not
trigonometric); task 14 is a prism cross-section volume (not a pyramid angle); task 17 is a
rhombus/inscribed-circle problem; task 19 is a number-theory extremal-set problem. Each was solved
from first principles for its own actual content — never pattern-matched from a sibling variant's
task of the same number.

### OCR / graphs — pixel-calibrated reads (№8, №11)

- **№8**: a tangent line through the origin touches `y=f(x)` at `x=4`. Pixel analysis of the
  rendered page located the touch point (marked with a dot and dashed guide lines) at exactly
  `(4; 5)` (gridline-snapped), giving slope `f'(4) = 5/4 = 1.25`.
- **№11**: `f(x)=k/x+b`. Pixel analysis initially mis-measured one dashed asymptote candidate
  (a faint regular gridline bled into the first scan) — re-verified with a robust multi-column
  dash-row scan, resolving to asymptote `y=−3`. Combined with two marked lattice points, `(−1;0)`
  and `(3;−4)`, both independently confirm `b=−3, k=−3` (all three constraints agree exactly,
  cross-checked against each other before publishing — see the independent-solve notes in the
  import script's task-11 explanation).

Both graphs are cropped directly from the source PDF page (no fabricated/re-drawn SVG), stored at
`apps/web/public/tasks/imports/ege-2026-variant-3/task-{08,11}-graph.png`.

### Task 18 and 15 — compound (non-atomic) answer expressions

Unlike Вариант 1/2's `interval`-type tasks (whose bounds are single atomic log/sqrt expressions
the shared interval parser understands), Вариант 3's task 15 bound (`−4√2−3`, a sum of two terms)
and task 18's answer (a union of two points and an interval) are **not** expressible as atomic
bounds the parser (`packages/shared/src/intervalAnswer.ts`) can evaluate. Both are published as
`short_answer` instead — the same precedent Вариант 1's own task 18 and Вариант 2's task 18 already
established for this exact situation; never forced into the `interval` type just because the
*shape* of the answer looks interval-like.

## Stable-key / dedup, topics/skills, Canonical Solution System

Same conventions as Вариант 2 (see `ege-2026-variant-2-report.md` for the general policy):
`contentHash` computed per task from its own real statement, shared `ege-2026-yashchenko`
collection (now 3 variants), topic slugs reused where Вариант 1/2 already established the same
`taskNumber` topic family, new slugs added where Вариант 3's actual content differs (e.g.
`derivative-tangent`, `planimetry-parallelograms`, `exponential-equations`, `stereometry-prism`,
`planimetry-rhombus`, `number-theory-sets`, `cubic-equations`, `trig-identities`,
`function-extrema-interval`, `work-word-problems`, `geometry-word-problems` — all genuinely new
topic content for this book, not pattern-guessed from the task number). No new canonical-solution
content files authored (same safe no-op as Вариант 1's own un-authored tasks).

## Regression / QA

- `importEge2026Variant3.test.ts` (db): 9/9 passing.
- `importedVariant3.test.ts` (api): 4/4 passing — multi_part grading, image delivery,
  `correctAnswerDisplay`, short_answer end-to-end.
- `realImportedData.test.ts` (api, taskSimilarity): extended to 3 variants — Вариант 2's task №7
  now confirmed to surface both Вариант 1 and Вариант 3's task №7, never a different number.
- Full `pnpm check` and `pnpm -r build`: see commit message for the run this report accompanies.
