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
 * substring check) and pins down the fix: all eight importers (extended
 * to Вариант 6, Вариант 7 and Вариант 8 alongside the new imports) are
 * invoked, strictly in order, `&&`-chained so a failing importer stops
 * the deploy instead of letting later ones (or `api`/`worker`) start
 * against a half-synced database.
 */
describe('infra/docker-compose.yml — sync-content runs all eight EGE-2026 variant imports', () => {
  const composePath = fileURLToPath(new URL('../../../infra/docker-compose.yml', import.meta.url));
  const compose = readFileSync(composePath, 'utf-8');

  // Isolate just the sync-content service block (up to the next
  // top-level "  api:" service) so a match elsewhere in the file
  // (e.g. a doc comment) can't accidentally satisfy this test.
  const serviceMatch = compose.match(/ {2}sync-content:\n([\s\S]*?)\n {2}api:/);
  if (!serviceMatch)
    throw new Error('sync-content service block not found in infra/docker-compose.yml');
  const serviceBlock = serviceMatch[1]!;

  it('invokes all eight importEge2026VariantN.js scripts', () => {
    for (let n = 1; n <= 8; n++) {
      expect(serviceBlock).toContain(`node_modules/@zybrilka/db/dist/importEge2026Variant${n}.js`);
    }
  });

  it('runs them strictly in order V1 -> V2 -> V3 -> V4 -> V5 -> V6 -> V7 -> V8', () => {
    const positions = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      serviceBlock.indexOf(`importEge2026Variant${n}.js`),
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('chains every import with && so a failing importer stops the sequence with a non-zero exit', () => {
    // Count of "&&" between the eight invocations must be exactly 7 —
    // not ";" (which would silently continue past a failure) and not
    // "||" (which would swallow one).
    const andCount = (serviceBlock.match(/&&/g) ?? []).length;
    expect(andCount).toBe(7);
    expect(serviceBlock).not.toMatch(/importEge2026Variant\d\.js\s*;/);
  });

  it('still depends on sync-subjects completing first, same as before the fix', () => {
    expect(serviceBlock).toMatch(
      /depends_on:\s*\n\s*sync-subjects:\s*\n\s*condition: service_completed_successfully/,
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
});
