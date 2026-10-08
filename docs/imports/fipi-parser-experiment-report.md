# FIPI Open Bank Parser — Experiment Report

## Status: BLOCKED (no live extraction performed) — static code audit completed instead

This is a research/feasibility block, not an import. No FIPI tasks exist anywhere in the
Zybrilka repository or database as a result of this experiment. The existing Ященко source
(`ege-2026-yashchenko`, V1–V5, 95 tasks) was not touched in any way.

## Source

- **Repository:** https://github.com/potamotus/fipiparcer
- **Cloned to:** `/tmp/fipiparcer_experiment` (outside the Zybrilka repo — nothing from the
  parser's own repo was copied into Zybrilka)
- **Commit audited:** `2199e3b` (2026-05-24)
- **Intended source name (not yet created):** `fipi-open-bank` — kept conceptually separate
  from `ege-2026-yashchenko` throughout this report; see "Architecture" below
- **Host:** `ege.fipi.ru` (ЕГЭ профильная математика, per the repo's own table)
- **Project GUID:** `AC437B34557F88EA4115D2F374B0A07B`
- **Intended run command:** `python fipiparcer.py sample-docx --host ege.fipi.ru --proj AC437B34557F88EA4115D2F374B0A07B --n 20`

## Why no live extraction happened

Two independent blockers, confirmed directly rather than assumed:

1. **This sandboxed environment's own network policy denies `ege.fipi.ru`.** A direct
   `curl` to the exact URL the parser would open returned a hard proxy rejection:
   `CONNECT tunnel failed, response 403` / `connect_rejected (gateway answered 403 to
   CONNECT — policy denial)`. This is an organization-level egress rule for this container,
   not a FIPI-side block — it fails before any request reaches FIPI at all.
2. **Even without that, the parser's own README states FIPI's open bank is itself
   geo-restricted to Russian IPs** (`"Доступ в интернет (банк ФИПИ открыт только для
   российских IP)"`, and `fipiparcer.py`'s own docstring: `"fipi.ru закрыт для не-российских
   IP. Запускать с RU-VPN."`). This cloud container's egress is not a Russian IP, so even
   with the environment's own policy relaxed, the request would very likely still be
   rejected by FIPI itself.

Given both, running `playwright install chromium` and executing the parser would not have
produced real data in this session — doing so anyway would just burn time downloading a
~150MB browser for a request guaranteed to fail, so it was not attempted. **No extraction
numbers below are fabricated or guessed** — everything in "Extraction" and "Quality" is
either "N/A — not run" or derived from reading the parser's actual source code (confirmed
field-by-field against `extractor.py`, `fipiparcer.py`, `docx_builder.py`, `math_convert.py`),
never from assumed/typical FIPI output.

## Extraction

| Metric | Result |
|---|---|
| Tasks extracted | **0 — not run** (network blocked, see above) |
| Successful | N/A |
| With images | N/A |
| With formulas | N/A |
| With answers | **0 by design — see "Answers" below; this is true regardless of whether the run succeeds** |

## What the parser's code actually does (verified by reading, not by running)

### How FIPI's bank is structured, per the code

- The page is a flat, paginated list of `.qblock` elements (10 per page), reached via
  `GET https://{host}/bank/questions.php?proj={GUID}&init_filter_themes=1`, then
  `&page={n}` for subsequent pages (determined by trial — see the repo's own
  `scripts/debug_pagination.py`, a diagnostic script the parser's author wrote specifically
  because the pagination parameter was **not documented and had to be reverse-engineered**).
- Each `.qblock` carries: `qid` (from the DOM element's own `id="q..."` attribute — FIPI's
  **short, bank-internal id**, not the official exam task number), and a `guid` (from a
  hidden `<input name="guid">` — a 32-character identifier the README states FIPI keeps
  stable even if it reshuffles the bank or renumbers the qid).
- **There is no "variant" concept anywhere in the code or the page it scrapes.** `--n 20`
  literally means "collect the first 20 distinct-`guid` blocks encountered while paging
  through the bank in whatever order FIPI serves them" — confirmed by reading
  `extract_tasks`'s loop in `extractor.py`. This is exactly the "NOT a variant" case the
  task brief anticipated. The open bank is a flat, dedupe-by-GUID question pool, not an
  assembled exam.
- **No official ЕГЭ task number (№1–19) is extracted anywhere.** The DOM's own `qid` is
  FIPI's bank-catalog id (a different numbering space entirely, often a long non-sequential
  number), not "1" through "19". Nothing in `EXTRACT_JS` reads a task-number field.
- **No topic/theme field is extracted**, despite the URL carrying `init_filter_themes=1` —
  that query param only pre-expands the theme filter *sidebar UI* on the page; the parser
  never reads which theme is selected or attached to a task, and never filters by it.
- **No difficulty metadata is extracted.**

### Text, math, images

- Text and MathML formulas are extracted together as an ordered stream of typed "chunks"
  (`text` / `math` / `image` / `break`) via a DOM-walking JS function
  (`EXTRACT_JS` in `extractor.py`), which correctly distinguishes real content from
  `<script>`/`<style>` nodes.
- Formulas come from MathJax's own internal `MathJax.startup.document.math` array (matched
  back to each `<mjx-container>` DOM node) — i.e. the parser reads FIPI's own already-parsed
  MathML, not a re-OCR or guess, which is the right approach *if* it actually runs; this is
  a structurally sound approach, not a red flag.
- Formulas are then converted MathML → OMath (real editable Word equations) via the
  `mathml2omml` library (`math_convert.py`) — **this dependency is imported in the code but
  is missing from `requirements.txt`** (only `playwright`, `pillow`, `img2pdf` are listed).
  A fresh `pip install -r requirements.txt` would fail at the formula-conversion step with
  `ModuleNotFoundError: No module named 'mathml2omml'`. This is a real, verifiable bug in
  the upstream repo (confirmed by diffing the import list in `math_convert.py` against
  `requirements.txt`), independent of network access.
- Images are fetched through the same authenticated Playwright browser context
  (`fetch_image`, using `page.context.request.get`, so cookies/session carry over) —
  structurally correct, but can only be verified against real FIPI images once the network
  block is lifted.
- `clean_chunks` strips a fixed list of FIPI boilerplate phrases ("Впишите правильный
  ответ.", "Выберите правильный ответ.", "Дайте развёрнутый ответ.") — a reasonable,
  explicit allowlist-style cleanup, not a fragile regex guess.

### Answers

**The parser extracts no correct-answer value anywhere, for any task, by design.** Grepping
the entire codebase for "answer" shows every reference is either `answer_type`
(short/choice/extended — a UI/layout classification, not a correctness value) or
`with_answer_squares` (a printed blank grid of boxes in the generated `.docx`, for a
*student* to write their own answer into by hand — literally an image asset,
`assets/answer_squares.png`). There is no code path anywhere that reads FIPI's correct
answer key. This is consistent with how FIPI's own public Open Bank page is designed (a
self-study practice tool, not a published answer-key page) and is true regardless of
network access — it is a property of what the parser was built to do (generate printable
blank worksheets), not a bug introduced by not running it.

## Quality

| Check | Result |
|---|---|
| Text | **NOT VERIFIED (not run)** |
| Math | **NOT VERIFIED (not run)** — approach is structurally sound (reads MathJax's own parsed MathML), but real output never seen |
| Images | **NOT VERIFIED (not run)** |
| Answers | **FAIL — never extracted, by design, independent of network access** |
| Task number (№1–19) | **FAIL — never extracted** (only FIPI's own non-sequential `qid`) |
| Topic | **FAIL — never extracted** |
| Mapping to Zybrilka `Task` | **BLOCKED on the above two FAILs** — see "Architecture" |

No per-task #1–#19 table is included because zero tasks were extracted. Populating that
table with invented row data would be fabrication, which both this project's CLAUDE.md and
the task brief explicitly forbid.

## Architecture — FIPI raw → Zybrilka `Task`, as far as it goes today

| FIPI raw (from the parser's actual `Task`/`Chunk` dataclasses) | Zybrilka `tasks` column | Verdict |
|---|---|---|
| `guid` (32-char, stable per FIPI's own README) | `externalId`-equivalent — **there is no such column in `packages/db/src/schema.ts`'s `tasks` table today**; the closest existing field, `contentHash`, is derived from the *statement text*, not an external id | Needs a real schema column before any FIPI import — see below |
| `qid` | **Not `taskNumber`.** FIPI's bank-catalog id is a different numbering space than the official ЕГЭ №1–19; using it as `taskNumber` would misrepresent the task's real exam position | Needs either a separate "FIPI catalog id" field, or a manually-curated №1–19 mapping done by a human who knows which bank question maps to which official exam position — the parser cannot derive this on its own |
| ordered `content` chunks (text/math/image/break) | `rawStatement` + `conditionMd` | Feasible — the chunk stream is structurally close to what `conditionMd`'s Markdown+LaTeX construction already needs, modulo writing a text+MathML→Markdown/LaTeX renderer (not yet written; `math_convert.py` only targets OMath/Word, not LaTeX) |
| `answer_type` (`short`/`choice`/`extended`) | `answerType` (`short_answer`/`interval`/`multi_part`) | Not a direct match — FIPI's 3-way split is about UI layout (how the student enters an answer), not about Zybrilka's answer-grading shape; `choice` (multiple choice) has no equivalent in Zybrilka's current `answerType` enum at all |
| *(nothing)* | `correctAnswer` | **Cannot be populated from this parser's output at all** — see "Answers" above |
| *(nothing)* | `topicId` | **Cannot be populated** — no topic data extracted |
| images (raw bytes + extension) | `imageUrl` | Feasible once a real crop/save pipeline exists (same pattern already used for Ященко's graph images) — but unverified without a real run |
| *(nothing)* | `difficulty` | **Cannot be populated** — no difficulty data extracted; would need the same kind of manual/derived assignment the Ященко importers already do per task number, except FIPI has no task-number concept to key off of |

### Source identity (point 9 of the brief)

The existing schema already models this correctly without any change: `tasks.source` (free
text) + `tasks.sourceDocument`/`sourceUrl`/`sourceYear`/`sourceVariant`/`tags` already give
every task a provenance trail independent of `contentHash`. A future real FIPI importer would
simply use:

- `source = 'ФИПИ. Открытый банк заданий ЕГЭ'` (a distinct string from Ященко's
  `'Ященко ЕГЭ 2026. Типовые экзаменационные варианты'`)
- `sourceUrl = 'https://ege.fipi.ru/bank/questions.php?proj=...'`
- a new stable-key component for FIPI's `guid` (**this is the one real schema gap**: there is
  currently no column to hold an external-source id like FIPI's `guid` directly — `tags`
  could carry it as a workaround, e.g. `tags: ['fipi-open-bank', 'fipi-guid:xxxxx...']`, but
  a dedicated `externalId` (or `sourceExternalId`) text column on `tasks` would be the
  correct, non-hacky home for it, keyed in a new unique index alongside `source`). **This
  minimal schema addition is the only production-schema change a real FIPI importer would
  need** — nothing else in the existing collections/variants/variant_tasks model needs to
  change, and it would **not** need to be shared with or branch off the Ященко collection at
  all (FIPI would never use the `collections`/`variants` tables the way Ященко does, since it
  has no variant concept — it would just be `tasks` rows with no `variant_tasks` membership,
  surfaced through a different browsing UI, e.g. "По темам"/"По номерам" generic listing).

No schema change was made in this experiment — this is a design note for a future block, per
the brief's explicit instruction not to touch production schema for a first experiment.

## No experimental adapter/normalizer was written

Per the brief's own instruction ("если качество плохое — не надо насильно интегрировать
его... сначала отчёт"): since there is no real extracted data to normalize (network blocked)
and the parser's own code already shows `taskNumber`, `topic`, and `correctAnswer` are
structurally absent from its output regardless of network access, writing a
JSON-normalizer/adapter now would mean either (a) operating on zero real input, producing
nothing testable, or (b) inventing a plausible-looking shape from imagination — both of which
violate the project's explicit no-fabrication rule. No adapter code, no tests, and no
`data/output/` artifacts were created in this experiment.

## Answers to the 13 required questions

1. **Парсер реально запускается?** Not verified — `pip install`/`playwright install` were not
   run (no point: the actual network request is blocked regardless). The code itself is
   syntactically coherent and its logic was fully traced by reading, but "runs" in the sense
   of "produces real output" was not demonstrated.
2. **ФИПИ реально отдаёт данные?** Unknown — never reached. Two independent reasons it
   couldn't be reached from this session (environment policy + FIPI's own RU-IP restriction).
3. **Можно ли получить 19 заданий?** Unknown count-wise, but architecturally: yes, the
   pagination loop would collect up to `--n` distinct-GUID blocks — *if* network access
   existed. They would **not** be "Variant 1 of ЕГЭ" in Ященко's sense — just the first 19
   distinct questions the bank happens to serve for that `proj` GUID, in whatever order FIPI
   returns them. The brief's own fallback applies: this would have to be called a **SAMPLE**,
   never "Вариант 1".
4. **Можно ли надёжно определить taskNumber?** **No.** Confirmed by code read: the only
   identifiers present are `qid` (FIPI's own bank-catalog numbering, not the exam's №1-19)
   and `guid`. Mapping a FIPI question to an official exam task number is not something this
   parser (or, as far as the code shows, FIPI's open-bank page itself) provides — it would
   require either a separate, human-curated mapping, or a different FIPI endpoint/page this
   parser does not use.
5. **Есть ли стабильный GUID?** **Yes** — this is the one identifier the parser reliably
   captures, and the repo's own README explicitly documents it as FIPI's stable long-term id,
   immune to the bank being reshuffled.
6. **Сохраняются ли формулы?** Structurally yes (MathML read straight from MathJax's own
   parsed state, converted to OMath for Word) — but completely unverified against real output
   in this session.
7. **Сохраняются ли изображения?** Structurally yes (fetched through the authenticated
   browser context) — same caveat, unverified.
8. **Есть ли ответы?** **No, never — by design**, independent of network access. The parser
   only generates blank answer-squares for a student to fill in by hand; it does not read
   FIPI's correct-answer key anywhere in its code.
9. **Можно ли получить structured JSON без DOCX?** **Yes, more easily than the brief
   anticipated** — `extract_tasks()` in `extractor.py` already returns a list of plain Python
   `Task`/`Chunk` dataclasses *before* `docx_builder.py` ever runs. `fipiparcer.py`'s `main()`
   calls `extract_tasks()` then immediately pipes the result into `build_docx()` — a future
   adapter would simply call `extract_tasks()` directly and serialize the dataclasses to JSON
   itself, never touching `docx_builder.py` or DOCX at all. This is a clean, pre-existing seam
   — no DOCX round-tripping would ever be needed.
10. **Насколько легко преобразовать это в нашу Task model?** Partially easy, partially
    blocked. The content stream (text/math/image chunks) maps reasonably cleanly onto
    `conditionMd` once a chunk→Markdown/LaTeX renderer is written (not yet existing anywhere
    in this parser — `math_convert.py` only targets Word OMath). `correctAnswer`, `topicId`,
    `taskNumber`, and `difficulty` cannot be populated from this parser's output at all —
    they would all need to come from somewhere else (manual curation, a different FIPI page,
    or not at all for `topicId`/`difficulty` initially, following the same
    `needs_review`-status pattern the Ященко importer already uses for genuinely uncertain
    fields).
11. **Что нужно доработать?**
    - Fix the repo's own missing `mathml2omml` entry in `requirements.txt` (upstream bug,
      confirmed by code, unrelated to network).
    - Write a `extract_tasks()` → JSON serializer (the "clean seam" from point 9) — small,
      additive, never touches `docx_builder.py`.
    - Write a text/math chunk → `conditionMd` (Markdown+LaTeX) renderer — does not exist in
      any form in the current repo.
    - Decide how (or whether) to source `taskNumber`/`topicId`/`correctAnswer`/`difficulty`
      at all, since none of them come from this parser — this is the actual hard problem, not
      a parsing/formatting one.
    - Add the proposed `externalId` (or `sourceExternalId`) column + unique index on `tasks`
      (the one real schema gap identified above) before any FIPI data could be imported at
      all, stable-key-safe.
12. **Подходит ли этот parser как основа будущего FIPI importer?** **Conditionally, as a
    text/formula/image EXTRACTION layer only** — its DOM-walking/MathML-reading approach is
    sound and the `extract_tasks()` seam is clean to build on. It is **not** sufficient on its
    own to become a FIPI importer: it cannot supply `taskNumber`, `topicId`, or
    `correctAnswer`, which are three of the required fields for Zybrilka's `tasks` table. Any
    real FIPI importer would need those three solved by other means first — this parser alone
    does not get us there, with or without network access.
13. **Что делать следующим шагом?** Do **not** start building a FIPI importer yet. The
    concrete next steps, in order, are: (a) get this experiment actually run from an
    environment with real access to `ege.fipi.ru` (RU egress, outside this sandbox) to verify
    the text/math/image extraction quality claims above against real output — everything in
    this report past "what the code does" is unverified until that happens; (b) separately,
    decide how `taskNumber`/`topicId`/`correctAnswer` would be sourced for FIPI tasks at all,
    since the parser cannot supply them — this is a product/content decision, not an
    engineering one, and blocks any real import regardless of parser quality.
