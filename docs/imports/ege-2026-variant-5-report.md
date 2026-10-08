# EGE 2026 — Variant 5

## Source

Same source file as Вариант 2/3/4: `ЕГЭ_2026_Ященко_варианты_2-5.pdf` (user-provided ZIP excerpt).
Вариант 5 occupies the last 4 pages of this 16-page excerpt file — pages 13–16. Confirmed visually
by the "ВАРИАНТ 5" heading on page 13.

- **Subject:** Математика, профильный уровень. **Year:** 2026. **Variant:** 5.

## Pages

Page 13 — задания 1–7. Page 14 — задания 8–12. Page 15 — задания 13–17. Page 16 — задания 18–19.
Часть 1 = 1–12, Часть 2 = 13–19.

## Tasks

| № | Answer | Independent solve | Image | Publish |
|---|---|---|---|---|
| 1 | 0.65 | PASS | — | READY |
| 2 | −0.352 | PASS | — | READY |
| 3 | 729 | PASS | — | READY |
| 4 | 0.35 | PASS | — | READY |
| 5 | 0.31 | PASS (combinatorics/conditional-probability derivation, see below) | — | READY |
| 6 | −6 | PASS | — | READY |
| 7 | 54 | PASS | — | READY |
| 8 | 56 | PASS | — | READY |
| 9 | 0.06 | PASS | — | READY |
| 10 | 18 | PASS | — | READY |
| 11 | 36 | PASS (pixel-calibrated graph read, see below) | YES | READY |
| 12 | 91 | PASS | — | READY |
| 13 | −1.5 | PASS | — | READY (`short_answer`, single filtered root) |
| 14 | √6/3 (part б; part а proof verified by coordinates) | PASS | — | READY |
| 15 | x∈(−3;−1)∪(1;3)∪{4} | PASS | — | READY (`short_answer`, 3-piece union) |
| 16 | 1.5 | PASS | — | READY |
| 17 | 15√97/4 (part б; part а proof verified algebraically) | PASS | — | READY |
| 18 | a∈(−∞;−3)∪(−3;−1)∪(1;3)∪(3;+∞) | PASS | — | READY (`short_answer`, two excluded points) |
| 19 | а) да; б) нет; в) 111 | PASS (exhaustive search for б, monotonicity proof for в) | — | READY (`multi_part`) |

### OCR / graph — pixel-calibrated read

- **№11** (`f(x)=kx+b`, `g(x)=p√x`, intersecting at the origin and at point B): both marked dots
  were pixel-calibrated via connected-component / gridline-crossing analysis and landed **exactly**
  on grid intersections — no interpolation was needed. The dot on the line sits at `(3;1)`, the dot
  on the curve at `(4;4)`. This gives `f(x)=x/3` (from `b=0`, `3k=1`) and `g(x)=2√x` (from `p·2=4`).
  Solving `x/3=2√x` for `x≠0` gives the clean integer answer `x_B=36`.

The graph image is cropped directly from the source PDF page (no fabricated/re-drawn SVG), stored
at `apps/web/public/tasks/imports/ege-2026-variant-5/task-11-graph.png`. Unlike Вариант 1–4, Вариант
5's task 8 is a pure algebra/calculus problem (motion/derivative, no graph image) — no second image
was fabricated to match the usual "two images" pattern; this variant genuinely only has one graph.

### Task 1 — height-to-base identity, not the usual bisector-point construction

Unlike Вариант 4's task 1 (parallelogram with intersecting bisectors), Вариант 5's task 1 is an
isosceles-triangle height problem. The key step — `sin(∠A)=AH/AC` via the Law of Sines applied to
`AH=AB·sin(∠B)` — was derived fresh from the actual configuration, not reused from any sibling
variant's method, and yields the clean identity `sin(∠CAB)=AH/AC=13/20=0.65`.

### Task 5 — conditional probability on a running sum, independently re-derived

The running sum of die rolls is strictly increasing, so it can equal 4 at most once across the
whole 10-roll sequence. The event "the sum hits 4" is the disjoint union of hitting it on roll 1, 2,
3, or 4 (hitting it later is impossible since the minimum sum after 5 rolls is already 5). Each
case's probability was computed directly by counting compositions of 4 into that many positive
parts (3, 3, 3, and 1 ordered compositions respectively, out of `6^k` equally likely outcomes),
giving `343/1296` total and `108/1296` for exactly two rolls — a conditional probability of
`108/343≈0.3149`, rounding to `0.31`.

### Task 13 — single root in the interval, not two

Вариант 4's task 13 (an exponential equation) happened to have both algebraic roots land inside its
given interval, so it was published as `multi_part`. Вариант 5's task 13 is a **logarithmic**
equation: substituting `u=log_4(x+2)` reduces it to the cubic `4u³+4u²−u−1=0`, which factors cleanly
as `(u+1)(2u−1)(2u+1)=0`, giving three roots `x∈{−1.75, 0, −1.5}`. Checking against the interval
`[log_0.4(4); log_4(0.4)]≈[−1.513; −0.661]` shows only `x=−1.5` qualifies (`−1.75` falls just short
of the left bound, `0` is far outside the right bound) — so this task is published as a plain
`short_answer`, matching the established precedent (V1–V3's own task 13 pattern) rather than being
force-fit into `multi_part`.

### Task 14 — pyramid, not prism; a clean coordinate proof

Вариант 5's task 14 is a **pyramid** problem (`SABCD`, regular square-base pyramid with apex `S`),
genuinely distinct from V3/V4's prism-based task 14. Using coordinates centered on the base (so
`O=(0,0,0)`, `S=(0,0,3)`), the plane `SAC` collapses to the simple equation `x=y`, which makes
finding point `N` (the intersection of line `DK` with that plane) and verifying the `1:2` division
of `SA` a clean parametric computation rather than requiring synthetic-geometry lemmas. Part б
(distance between skew lines `DK` and `SC`) uses the standard cross-product distance formula,
giving `√6/3`.

### Task 17 — two circles of equal radius tangent to both parallel bases; a derived (not assumed) ratio direction

A key observation drives this problem: since **both** inscribed circles are tangent to **both**
parallel bases `AD` and `BC` (not just one), they necessarily share the same radius
`ρ = h/2` (half the trapezoid's height) — this is a direct consequence of a circle tangent to two
parallel lines having its diameter equal to the distance between them, not an assumption. Using the
equal-tangent-length property from vertex `D`, the touch-point ratio `CT:TD=1:4` was solved assuming
`C`-side first (not guessed) and independently confirmed to reproduce the given `r=0.4·CD` identity
exactly, which both proves part а and pins down `m=3c/5`, `h=4c/5`. Part б then requires an
additional relation (not given directly) — the external-tangency condition between the two circles,
combined with the trapezoid's left–right mirror symmetry, which pins down `AD=h+c+m=72` and
`BC=36`. The final circumradius `15√97/4` was verified two independent ways: via the
Law-of-Sines/triangle-circumradius formula on `△ABD`, and via direct coordinate geometry (equating
distances from a candidate center `(36,k)` to `A` and `B`) — both methods agreed exactly.

### Task 18 — factoring the quartic as a difference of squares; two special values found and excluded by direct substitution

Substituting `y=ax` and setting `u=x`, `v=y+a=a(x+1)` factors the quartic equation as
`(u²−v²)(u²+v²−0.5a²)=0`, splitting into three independent cases: `u=v`, `u=−v`, and
`u²+v²=0.5a²` (a quadratic in `x` with discriminant `D=8a²(a²−1)`, giving two distinct real roots
exactly when `|a|>1`). Generically this gives `2+1+1=4` distinct solutions for `|a|>1`. Rather than
assume all four stay distinct, the overlap conditions were solved algebraically and then verified
by direct substitution: at `a=3`, case `u=v`'s root (`x=−1.5`) exactly coincides with one of the
quadratic case's two roots (confirmed by solving `20x²+36x+9=0` directly and finding roots
`{−0.3,−1.5}`), collapsing the count to 3 solutions; by the equation's symmetry in `a²`, the
quadratic case's roots are identical at `a=−3`, where `u=−v`'s root instead collides with one of
them. Both `a=±3` are excluded from the final answer, which was additionally spot-checked
numerically at `a=2`, `a=4`, and `a=−2` (all four roots distinct in each case, confirming the open
intervals are correctly included).

### Task 19 — digit-product ratio; part б settled by exhaustive search, part в by a monotonicity argument

Part а is settled by direct example (`144=9·16`, also `135=9·15`). Part б (`N=2abc`) was checked by
deriving `b=(100a+c)/(2ac−10)` for each `a∈{1,…,9}` and testing every `c∈{1,…,9}` with a positive
denominator — not a single integer solution for `b∈{1,…,9}` exists across the full grid, so the
answer is "нет". Part в rewrites the ratio as `N/(abc)=100/(bc)+10/(ac)+1/(ab)` — each term is a
strictly decreasing function of the variables it depends on, and since `a,b,c≥1` independently,
every term is simultaneously maximized at `a=b=c=1` (no trade-off exists between the terms, since
each pair of variables not shared by a term cannot affect it). This proves `111` (at `N=111`) is the
true global maximum, not merely a locally-checked candidate.

## Stable-key / dedup, topics/skills, Canonical Solution System

Same conventions as Вариант 2/3/4 (see `ege-2026-variant-2-report.md` for the general policy):
`contentHash` per task from its own real statement, shared `ege-2026-yashchenko` collection (now 5
variants). Topic slugs were reused where Вариант 1–4 already established a matching content family
for the same `taskNumber` (`planimetry-triangles`, `vectors`, `stereometry-solids`,
`probability-basic`, `exponential-equations`, `logarithms`, `functions-graphs`,
`function-extrema-interval`, `inequalities-log-exp`, `economics-problems`, `parameters`), and new,
more specific slugs were created where this variant's content is genuinely a different sub-topic
from any sibling variant's same-numbered task — never forced to match artificially:
`derivative-applications` (task 8 — velocity via derivative, not a tangent-line graph read),
`physics-formulas` (task 9 — kinetic-energy word problem, genuinely distinct from exponential/motion
word-problem families used elsewhere), `mixture-word-problems` (task 10 — acid-concentration
mixing, distinct from the work/motion word-problem families), `logarithmic-equations` (task 13 — a
genuine logarithmic equation, distinct from the exponential-equation family reused for V3/V4's task
13), `stereometry-pyramid` (task 14 — a pyramid, distinct from V3/V4's prism), `planimetry-trapezoid`
(task 17 — a trapezoid with two inscribed circles, distinct from the rhombus/circle families used
elsewhere), and `number-theory-digits` (task 19 — a digit-product ratio problem, distinct from both
V1/V2's coin-collection divisibility problem and V3/V4's integer-set problem). No new canonical-
solution content files were authored (same safe no-op as the other variants' un-authored tasks).

## Similar Tasks (taskNumber hard filter) on real data

`apps/api/src/modules/learning/taskSimilarity/realImportedData.test.ts` extended to 5 variants.
Specifically verified for Вариант 5 tasks №1, №10, and №19 (as required): each only ever surfaces
same-`taskNumber` candidates from Вариант 1–4, never a different number — confirmed both via
targeted per-number tests and the full-catalog sweep covering every `(subject, taskNumber)` pair
currently in the database (now spanning all 5 variants × 19 numbers = 95 tasks).

## Regression / QA

- `importEge2026Variant5.test.ts` (db): 10/10 passing — 19 tasks, no gaps, correct `answerType`
  per task, full provenance, image on task 11 only, idempotent re-import, one shared collection +
  two variants (with V1), stable ids across re-import.
- `importedVariant5.test.ts` (api): 5/5 passing — short_answer end-to-end (task 13), multi_part
  grading (task 19), image delivery, `correctAnswerDisplay`.
- `realImportedData.test.ts` (api, taskSimilarity): extended to 5 variants, including dedicated
  checks for Вариант 5 tasks №1, №10, №19.
- Full `pnpm check` (typecheck + lint + test, all packages) and `pnpm -r build`: see commit message
  for the run this report accompanies.
