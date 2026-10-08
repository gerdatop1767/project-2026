# EGE 2026 — Variant 2

## Source

- **Document:** «ЕГЭ 2026 Ященко 36 вариантов» (тот же сборник, что и Вариант 1), источник этого
  импорта — файл `ЕГЭ_2026_Ященко_варианты_2-5.pdf`, предоставленный пользователем напрямую
  (ZIP-архив, загруженный в чат) — не скачивался автоматически ни с одного сайта. Это 16-страничная
  выдержка (страницы 6–21 исходной книги), содержащая только варианты 2–5; варианты 6–36 из
  исходного файла не импортировались и не импортируются.
- **Provenance policy:** единственный источник заданий — этот PDF. Коррекция OCR-искажений
  сверялась только с исходной страницей PDF.
- **Subject:** Математика, профильный уровень.
- **Year:** 2026.
- **Variant:** 2 (первый из четырёх вариантов 2–5, обрабатываемых по одному — малыми логическими
  блоками, с отдельным коммитом на каждый).

## Pages

Вариант 2 занимает страницы **1–4** файла `ЕГЭ_2026_Ященко_варианты_2-5.pdf` (= страницы 6–9
исходной книги, подтверждено README, приложенным к архиву, и визуально по заголовку «ВАРИАНТ 2» на
первой странице): страница 1 — задания 1–6, страница 2 — задания 7–11, страница 3 — задания 12–16,
страница 4 — задания 17–19.

Структура подтверждена визуально по PDF: Часть 1 = задания 1–12 (короткий числовой/десятичный
ответ), Часть 2 = задания 13–19 (полное решение + ответ) — идентична структуре Варианта 1.

## Tasks

| № | Parse | Answer | Independent solve | Explanation | Image | Publish |
|---|---|---|---|---|---|---|
| 1 | PASS | 81° | PASS | PASS | — | READY |
| 2 | PASS | 37 | PASS | PASS | — | READY |
| 3 | PASS | 3.125 | PASS | PASS | — | READY |
| 4 | PASS | 0.995 | PASS | PASS | — | READY |
| 5 | PASS | 0.05 | PASS | PASS | — | READY |
| 6 | PASS | 0.8 | PASS | PASS | — | READY |
| 7 | PASS | −4 | PASS | PASS | — | READY |
| 8 | PASS | 2 | PASS (pixel-calibrated graph read, see below) | PASS | YES | READY |
| 9 | PASS | 32 | PASS | PASS | — | READY |
| 10 | PASS | 224 | PASS | PASS | — | READY |
| 11 | PASS | −14 | PASS (pixel-calibrated graph read, see below) | PASS | YES | READY |
| 12 | PASS | −1 | PASS | PASS | — | READY |
| 13 | PASS | 29π/6; 31π/6; 11π/2 | PASS | PASS | — | READY |
| 14 | PASS | arccos(17/35) (part б; part а proof verified by coordinates) | PASS | PASS | — | READY |
| 15 | PASS | x∈(log₃2; log₃2.2) ∪ (log₃2.2; log₂5] | PASS | PASS | — | READY (`interval`) |
| 16 | PASS | 6 | PASS | PASS | — | READY |
| 17 | PASS | 3√(4−2√2) (part б; part а proof verified by coordinates) | PASS | PASS | — | READY |
| 18 | PASS | a∈(2; √13−1) | PASS | PASS | — | READY |
| 19 | PASS | а) нет; б) 833; в) 1001 | PASS (computer-verified exhaustive search) | PASS | — | READY (`multi_part`) |

### OCR / graphs — pixel-calibrated reads (№8, №11)

Both graph-dependent tasks were read directly off the rendered PDF page at 150 dpi, with gridline
and curve positions located by pixel-darkness analysis (not eyeballed) before any number was
written down:

- **№8** (derivative sign graph, domain `(−1;17)`): the two `+→−` sign changes of `f'(x)` within
  `[1;15]` were located at ≈4 and ≈10–11; a third, smaller hump (≈12–14) stays entirely below the
  axis and contributes no extremum. **Answer: 2** maximum points — independently confirmed by
  re-tracing the curve pixel-by-pixel a second time.
- **№11** (parabola `f(x)=ax²+bx+c`): root columns and the vertex row were located by scanning the
  rendered page for the darkest (boldest) pixels near the x-axis and comparing against the detected
  gridline spacing (≈120 px/unit, uniform in both axes). This resolved an initial misread (a rough
  visual pass suggested roots at −1 and 6, which failed to reproduce the vertex height shown in the
  image); the pixel-exact pass found roots at **x=−1 and x=4**, vertex at **(1.5; 6.25)**, giving
  `f(x)=−(x+1)(x−4)` and **f(−3)=−14** — cross-checked algebraically (`f(0)=4` lands exactly on a
  gridline row, matching the image).

Both graph images are cropped directly from the source PDF page (no fabricated/re-drawn SVG) and
stored at `apps/web/public/tasks/imports/ege-2026-variant-2/task-{08,11}-graph.png`.

## Stable-key / dedup

- `contentHash = sha256(subjectId|taskNumber|normalize(rawStatement))` — same formula as Variant 1,
  computed per task from its own real transcribed statement. All 19 hashes for Variant 2 are
  distinct from each other and from Variant 1's 19 hashes (different wording/numbers per task, as
  expected for two real, distinct exam variants of the same question-number slot).
- Collection: shared `ege-2026-yashchenko` slug with Variant 1 — **one** collection row, two
  `variants` rows (`variantNumber` 1 and 2), confirmed by test
  (`importEge2026Variant2.test.ts`: *"shares one collection with Вариант 1"*).
- Re-running the import is idempotent: task ids are matched by `(subjectId, source, sourceVariant,
  taskNumber)` and updated in place, never deleted and reinserted (same pattern as Variant 1) —
  confirmed by test (*"keeps every task id stable across a re-import"*).

## Topics / skills

Every `topicSlug` used below already existed from the Variant 1 import (same `taskNumber` →
broadly the same topic family, per the exam's own stable question-number structure) — no new topic
slugs were minted, confirmed against `importEge2026Variant1.ts`'s own `importTasks` list before
writing Variant 2's.

No new `methodTags`/skills were authored for Variant 2's Part 2 tasks (13–19) — this import does
not add new Canonical Solution System entries (see below), so `task_skills` coverage for these new
tasks stays at zero, same baseline as Variant 1's own unauthored tasks. This does not affect
grading, explanations, or Similar Tasks — none of those read `task_skills`.

## Canonical Solution System

No new `realTaskNVariant2.ts` canonical-solution content files were authored in this block — every
task (including Part 2, 13–19) already carries a full `explanationMd`, `hintMd`, and per-step
`solutionSteps` written directly into the import script (same shape Variant 1 used for its own
initial import before any canonical-solution authoring). `getCanonicalSolutionForTask` simply
returns `undefined` for these tasks' content hashes — a safe no-op already exercised by Variant 1's
own tasks 1–12. Authoring dedicated canonical-solution files for Variant 2 (like Variant 1's tasks
13–19 have) is optional future work, not required for the import or for grading to function.

## Similar Tasks (taskNumber hard filter) on real data

`apps/api/src/modules/learning/taskSimilarity/realImportedData.test.ts` proves the hard filter
(commit `7b311ca`) holds against real imported rows spanning two real variants: Вариант 1's task №7
and Вариант 2's task №7 cross-link to each other, and every imported task across both variants only
ever returns same-taskNumber candidates — confirmed for the full real catalog (all `(subject,
taskNumber)` pairs that currently exist), not just the two variants' task №7.

## Regression / QA

- `importEge2026Variant2.test.ts` (db): 11/11 passing — 19 tasks, no gaps, correct `answerType` per
  task, full provenance, images on tasks 8/11 only, idempotent re-import, one shared collection +
  two variants, stable ids across re-import.
- `importedVariant2.test.ts` (api): 5/5 passing — interval and multi_part grading through the real
  `POST /tasks/:id/attempt` endpoint, image delivery, `correctAnswerDisplay`, mistake recording.
- `realImportedData.test.ts` (api, taskSimilarity): 3/3 passing — real-data adversarial proof the
  taskNumber hard filter holds across variants.
- Full `pnpm check` (typecheck + lint + test, all packages) and `pnpm -r build`: see commit message
  for the run this report accompanies.
