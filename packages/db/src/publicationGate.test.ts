import { describe, expect, it } from 'vitest';
import {
  articleContentHash,
  buildFactCheckRecord,
  evaluatePublicationGate,
} from './publicationGate.js';

const C = { title: 'T', bodyMd: 'Задание 13 — 2 балла.', faq: [] };
const rec = (o: Partial<Parameters<typeof buildFactCheckRecord>[0]> = {}) =>
  buildFactCheckRecord({
    verdict: 'pass',
    factualIssues: [],
    webChecked: true,
    webSources: ['https://fipi.ru'],
    contentHash: articleContentHash(C),
    checkedAt: new Date(),
    ...o,
  });

describe('publication gate (pure)', () => {
  it('hash ignores images and spacing, not words', () => {
    const h = articleContentHash(C);
    expect(
      articleContentHash({
        ...C,
        bodyMd: `${C.bodyMd}\n\n![x](media:0f9b8b7a-1111-4222-8333-944455556666)  `,
      }),
    ).toBe(h);
    expect(articleContentHash({ ...C, bodyMd: 'Задание 13 — 3 балла.' })).not.toBe(h);
    expect(articleContentHash({ ...C, faq: [{ question: 'q', answer: 'a' }] })).not.toBe(h);
  });

  it('«verified» needs pass + no issues + real search results', () => {
    expect(rec().result).toBe('verified');
    expect(rec({ webSources: [] }).result).toBe('failed');
    expect(rec({ webChecked: false }).result).toBe('failed');
    expect(rec({ verdict: 'fix' }).result).toBe('failed');
    expect(
      rec({ factualIssues: [{ claim: 'x', severity: 'minor', status: 'unverified' }] }).result,
    ).toBe('failed');
  });

  it('fail-closed issue classification', () => {
    const r = rec({
      verdict: 'fix',
      factualIssues: [
        { claim: 'a' },
        { claim: 'b', severity: 'critical', status: 'unverified' },
        { claim: 'c', severity: 'minor' },
        { claim: 'd', severity: '???', status: '???' },
      ],
    });
    expect(r.criticalContradictions).toEqual(['a', 'd']);
    expect(r.unverifiedCritical).toEqual(['b']);
    expect(r.minorIssues).toEqual(['c']);
  });

  it('decides only from the server record and the manual approval', () => {
    const g = (reviewNotes: unknown, status = 'review') =>
      evaluatePublicationGate({ target: 'publish', status, content: C, reviewNotes });
    expect(g({ factCheck: rec() })).toMatchObject({ allowed: true, basis: 'verified' });
    expect(g({ verdict: 'pass' }).allowed).toBe(false);
    expect(g(null).reasons).toEqual(['no_fact_check']);
    expect(g({ factCheck: rec() }, 'published').reasons).toEqual(['status_not_allowed']);
    expect(g({ factCheck: rec({ contentHash: 'a'.repeat(64) }) }).reasons).toEqual([
      'stale_fact_check',
    ]);
    const manual = {
      adminId: 'u',
      at: new Date().toISOString(),
      reason: 'проверено вручную',
      contentHash: articleContentHash(C),
      revisionId: null,
    };
    expect(g({ manualApproval: manual })).toMatchObject({ allowed: true, basis: 'manual' });
    const contradicted = rec({
      verdict: 'fix',
      factualIssues: [{ claim: 'x', severity: 'critical', status: 'contradicted' }],
    });
    expect(g({ factCheck: contradicted, manualApproval: manual })).toMatchObject({
      allowed: false,
      manualAllowed: false,
    });
  });
});
