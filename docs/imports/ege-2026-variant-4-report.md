# EGE 2026 — Variant 4

## Source

Same source file as Вариант 2/3: `ЕГЭ_2026_Ященко_варианты_2-5.pdf` (user-provided ZIP excerpt).
Вариант 4 occupies pages 9–12 of this excerpt file (= pages 14–17 of the original book). Confirmed
visually by the "ВАРИАНТ 4" heading on page 9.

- **Subject:** Математика, профильный уровень. **Year:** 2026. **Variant:** 4.

## Pages

Page 9 — задания 1–4. Page 10 — задания 5–10. Page 11 — задания 11–14. Page 12 — задания 15–19.
Часть 1 = 1–12, Часть 2 = 13–19.

## Tasks

| № | Answer | Independent solve | Image | Publish |
|---|---|---|---|---|
| 1 | 2.5 | PASS | — | READY |
| 2 | 4 | PASS (pixel-calibrated graph read, see below) | — | READY |
| 3 | 3.5 | PASS | — | READY |
| 4 | 0.12 | PASS | — | READY |
| 5 | 0.75 | PASS | — | READY |
| 6 | −10 | PASS | — | READY |
| 7 | −7.5 | PASS | — | READY |
| 8 | −0.4 | PASS (pixel-calibrated graph read) | YES | READY |
| 9 | 40 | PASS | — | READY |
| 10 | 9 | PASS | — | READY |
| 11 | 1.9 | PASS (pixel-calibrated graph read, see below) | YES | READY |
| 12 | 0.8 | PASS | — | READY |
| 13 | −log₂25/10; −0.2 (both roots in range) | PASS | — | READY (`multi_part`, two roots) |
| 14 | 118√7/7 (part б; part а proof verified by coordinates) | PASS | — | READY |
| 15 | x∈(−∞;−2) ∪ [2+√2/4;+∞) | PASS | — | READY (`short_answer`, compound bound) |
| 16 | 4 | PASS | — | READY |
| 17 | 5/3 (part б; part а proof verified by coordinates) | PASS | — | READY |
| 18 | a∈(−3;0), a≠(−5−√13)/6, a≠(−5+√13)/6 | PASS | — | READY (`short_answer`, excluded points) |
| 19 | а) да; б) нет; в) −4625 | PASS (derived necessary bound + construction, numerically cross-checked) | — | READY (`multi_part`) |

### OCR / graphs — pixel-calibrated reads, including one self-caught and corrected error

- **№2** (vectors on grid): pixel-calibrated both vector endpoints via connected-component /
  density analysis. `a⃗=(6;4)`, `b⃗=(6;−7)`.
- **№8** (tangent line through origin, touches `y=f(x)` at `x=5`): touch point located at `(5;−2)`
  via gridline-snapped pixel detection, giving `f'(5)=−0.4`.
- **№11** (`f(x)=k/x+b`): **an initial pixel search used the wrong crop region and returned a
  false right-hand point at `(2;2)`**, which produced an inconsistent system with the left point
  `(−1;0)` and the asymptote `y=2` (no single `k,b` satisfied all three). Rather than publish
  that, the measurement was re-done with a correctly-positioned crop and a direct zoomed visual
  re-read, which located the real right-hand point at `(1;4)` — consistent with the asymptote
  and the left point (`k=2, b=2`). This correction is recorded here per the "flag disputed
  spots, never guess" rule; no uncertain value was published.

Both graph images are cropped directly from the source PDF page (no fabricated/re-drawn SVG),
stored at `apps/web/public/tasks/imports/ege-2026-variant-4/task-{08,11}-graph.png`.

### Task 13 — two valid roots, not the usual "part б single root" shape

Unlike Вариант 1–3's task 13 (always a trig equation with one or more roots filtered to a given
interval), Вариант 4's task 13 is an exponential equation whose **both** algebraic roots happen to
land inside the given interval `[−0.5; 0]`. Published as `multi_part` with two `short_answer`
sub-parts (not the usual а/б/в convention, since there's no sub-question letters here — just two
roots to report) rather than force-fitting it into a single-value `short_answer` field.

### Task 17 — circumscribed (not inscribed) circle; a resolved reasoning dead-end

Вариант 4's task 17 part б asks for the circle **circumscribed about** `ABPD` (cyclic
quadrilateral), unlike Вариант 1–3's task 17 which asked for a circle **inscribed in** a
quadrilateral (tangential quadrilateral, `AB+PD=BP+AD`). These are different conditions requiring
different methods — solved fresh from the actual geometry, not reused from the sibling variants'
method.

While solving, computing the literal second intersection of ray `BH` with the circumcircle of
`△ABD` landed on the *backward* extension of the ray in the chosen coordinate frame, not the
forward ray the problem describes. This was investigated thoroughly (re-derivation from two
independent coordinate placements, both confirming the same `cos(∠A)=0.8` for part а) before
recognizing the key invariant: since `P` is constrained to lie on the circle already uniquely
determined by `A, B, D`, the quadrilateral's circumradius equals that triangle's circumradius
regardless of exactly where `P` sits on it. The published answer (`R=5/3`) is this circumradius,
computed directly and independent of the ray-direction question — the dead-end is recorded here for
transparency rather than silently dropped.

## Stable-key / dedup, topics/skills, Canonical Solution System

Same conventions as Вариант 2/3 (see `ege-2026-variant-2-report.md` for the general policy):
`contentHash` per task from its own real statement, shared `ege-2026-yashchenko` collection (now 4
variants), topic slugs reused where Вариант 1–3 already established the same `taskNumber` topic
family (e.g. `planimetry-parallelograms`, `derivative-tangent`, `functions-graphs`,
`exponential-equations`, `stereometry-prism`, `planimetry-rhombus`, `number-theory-sets` — all
reused from Вариант 3 since this variant's task content matches those same families). No new topic
slugs were needed for Вариант 4. No new canonical-solution content files authored (same safe no-op
as the other variants' un-authored tasks).

## Similar Tasks (taskNumber hard filter) on real data

`apps/api/src/modules/learning/taskSimilarity/realImportedData.test.ts` extended to 4 variants.
Specifically verified for Вариант 4 tasks №1, №10, and №19 (as required): each only ever surfaces
same-`taskNumber` candidates from Вариант 1–3, never a different number — confirmed both via
targeted per-number tests and the full-catalog sweep covering every `(subject, taskNumber)` pair
currently in the database (now spanning all 4 variants × 19 numbers = 76 tasks).

## Regression / QA

- `importEge2026Variant4.test.ts` (db): 10/10 passing — 19 tasks, no gaps, correct `answerType`
  per task, full provenance, images on tasks 8/11 only, idempotent re-import, one shared collection
  + two variants (with V1), stable ids across re-import.
- `importedVariant4.test.ts` (api): 5/5 passing — multi_part grading (both task 13 and task 19),
  image delivery, `correctAnswerDisplay`, short_answer end-to-end.
- `realImportedData.test.ts` (api, taskSimilarity): extended to 4 variants, including dedicated
  checks for Вариант 4 tasks №1, №10, №19.
- Full `pnpm check` (typecheck + lint + test, all packages) and `pnpm -r build`: see commit message
  for the run this report accompanies.
