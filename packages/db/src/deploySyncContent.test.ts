import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Production content-deployment gap fix: `infra/docker-compose.yml`'s
 * one-shot `sync-content` service used to run ONLY
 * `importEge2026Variant1.js` on every deploy — Вариант 2-5 existed in
 * the built image and passed integration tests against an in-memory
 * test db (`createImportedVariantsTestDb`), but were never synced into
 * any real deployed Postgres. This test reads the actual compose file
 * (plain text — no YAML dependency needed for a simple ordered-
 * substring check) and pins down the fix: all ten math importers
 * (extended from the original V1-only service to V1-V10) are invoked,
 * strictly in order, `&&`-chained so a failing importer stops the
 * deploy instead of letting later ones (or `api`/`worker`) start
 * against a half-synced database.
 *
 * Follow-up gap fix: EGE Russian 2027 (Doshchinsky) Вариант 1 was a
 * deliberate pilot experiment, never added to this chain — production
 * ran `migrate` and `sync-content` successfully every deploy, but
 * `sync-content`'s logs only ever showed the ten math variants, so the
 * Russian catalog never appeared on the live site. Russian Вариант 1 was
 * then added, running last in the chain.
 *
 * Second follow-up gap fix (this one): by the time Russian Вариант 2-18
 * existed as production-format import scripts in
 * `packages/db/src/`, each with its own passing per-variant test file
 * (see `russianVariantMatrixAudit.test.ts` for the cross-variant audit),
 * they were STILL not wired into this chain — the same class of gap as
 * before, now fixed for the full set of 18 Russian variants. This file
 * now pins down that all 18 `importRussianDoshchinsky2027VariantN.js`
 * scripts run, in order, after the ten math importers, and that
 * `migrate` (which applies migrations 0017/0018 — `passages` and
 * `digit_set_order_insensitive`, both required by every Russian
 * importer) still runs before `sync-content` starts.
 */
/** «ЕГЭ 2027 Ященко» math variants imported so far (Вариант 1…N). */
const MATH_2027_VARIANTS = 14;

describe(`infra/docker-compose.yml — sync-content runs every EGE variant import (10 math 2026 + ${MATH_2027_VARIANTS} math 2027 + 18 Russian)`, () => {
  const composePath = fileURLToPath(new URL('../../../infra/docker-compose.yml', import.meta.url));
  const compose = readFileSync(composePath, 'utf-8');

  // Isolate just the sync-content service block (up to the next
  // top-level "  api:" service) so a match elsewhere in the file
  // (e.g. a doc comment) can't accidentally satisfy this test.
  const serviceMatch = compose.match(/ {2}sync-content:\n([\s\S]*?)\n {2}api:/);
  if (!serviceMatch)
    throw new Error('sync-content service block not found in infra/docker-compose.yml');
  const serviceBlock = serviceMatch[1]!;

  it('invokes all ten importEge2026VariantN.js scripts', () => {
    for (let n = 1; n <= 10; n++) {
      expect(serviceBlock).toContain(`node_modules/@zybrilka/db/dist/importEge2026Variant${n}.js`);
    }
  });

  it('invokes all eighteen importRussianDoshchinsky2027VariantN.js scripts', () => {
    for (let n = 1; n <= 18; n++) {
      expect(serviceBlock).toContain(
        `node_modules/@zybrilka/db/dist/importRussianDoshchinsky2027Variant${n}.js`,
      );
    }
  });

  it('runs the separate «ЕГЭ 2027 Ященко» math source (V1…VN, in order) after the 2026 math variants and before Russian', () => {
    const positions = Array.from({ length: MATH_2027_VARIANTS }, (_, i) =>
      serviceBlock.indexOf(
        `node_modules/@zybrilka/db/dist/importEge2027YashchenkoVariant${i + 1}.js &&`,
      ),
    );
    expect(positions[0]).toBeGreaterThan(serviceBlock.indexOf('importEge2026Variant10.js'));
    for (let i = 1; i < positions.length; i++)
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    expect(serviceBlock.indexOf('importRussianDoshchinsky2027Variant1.js')).toBeGreaterThan(
      positions[positions.length - 1]!,
    );
    // Exactly these 2027 importers — none skipped, none extra.
    expect(serviceBlock.match(/importEge2027YashchenkoVariant\d+\.js/g)).toHaveLength(
      MATH_2027_VARIANTS,
    );
  });

  it('runs them strictly in order: math V1 -> V10, then Russian V1 -> V18', () => {
    const mathPositions = Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
      serviceBlock.indexOf(`importEge2026Variant${n}.js`),
    );
    for (let i = 1; i < mathPositions.length; i++) {
      expect(mathPositions[i]).toBeGreaterThan(mathPositions[i - 1]!);
    }

    const russianPositions = Array.from({ length: 18 }, (_, i) => i + 1).map((n) =>
      serviceBlock.indexOf(`importRussianDoshchinsky2027Variant${n}.js`),
    );
    for (let i = 1; i < russianPositions.length; i++) {
      expect(russianPositions[i]).toBeGreaterThan(russianPositions[i - 1]!);
    }

    expect(russianPositions[0]).toBeGreaterThan(mathPositions[mathPositions.length - 1]!);
  });

  it('chains every import with && so a failing importer stops the sequence with a non-zero exit', () => {
    // 10 math 2026 + N math 2027 + 18 Russian + the stress dictionary,
    // joined by && — one "&&" fewer than invocations. Not ";" (which would
    // silently continue past a failure) and not "||" (which would swallow one).
    const invocations = 10 + MATH_2027_VARIANTS + 18 + 1;
    const andCount = (serviceBlock.match(/&&/g) ?? []).length;
    expect(andCount).toBe(invocations - 1);
    expect(serviceBlock).not.toMatch(/importEge2026Variant\d{1,2}\.js\s*;/);
    expect(serviceBlock).not.toMatch(/importRussianDoshchinsky2027Variant\d{1,2}\.js\s*;/);
    expect(serviceBlock).not.toContain('||');
  });

  it('still depends on sync-subjects completing first, same as before the fix', () => {
    expect(serviceBlock).toMatch(
      /depends_on:\s*\n\s*sync-subjects:\s*\n\s*condition: service_completed_successfully/,
    );
  });

  it('migrate still runs before sync-content, transitively via sync-subjects — migrations 0017/0018 (passages, digit_set_order_insensitive) are applied before any Russian importer needs them', () => {
    const syncSubjectsBlock = compose.match(
      / {2}sync-subjects:\n([\s\S]*?)\n {2}sync-content:/,
    )?.[1];
    expect(syncSubjectsBlock).toBeDefined();
    expect(syncSubjectsBlock).toMatch(
      /depends_on:\s*\n\s*migrate:\s*\n\s*condition: service_completed_successfully/,
    );
  });

  it('api and worker still wait for sync-content to complete successfully before starting', () => {
    const apiBlock = compose.match(/ {2}api:\n([\s\S]*?)\n {2}worker:/)?.[1];
    const workerBlock = compose.match(/ {2}worker:\n([\s\S]*?)\n {2}web:/)?.[1];
    expect(apiBlock).toBeDefined();
    expect(workerBlock).toBeDefined();
    for (const block of [apiBlock!, workerBlock!]) {
      expect(block).toMatch(/sync-content:\s*\n\s*condition: service_completed_successfully/);
    }
  });

  it('ends with the stress-dictionary import, after every variant import', () => {
    const stress = serviceBlock.indexOf(
      'node_modules/@zybrilka/db/dist/stressDictionary/import.js',
    );
    expect(stress).toBeGreaterThan(
      serviceBlock.indexOf('importRussianDoshchinsky2027Variant18.js'),
    );
    // Chained with && like the rest: a failing import fails the service.
    expect(serviceBlock).toMatch(
      /Variant18\.js &&\s+node node_modules\/@zybrilka\/db\/dist\/stressDictionary\/import\.js/,
    );
  });
});
