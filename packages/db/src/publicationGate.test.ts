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
    expect(rec({ factualIssues: [{ claim: 'x', category: 'numeric_fact' }] }).result).toBe(
      'failed',
    );
  });

  it("criticality is the server's, by category", () => {
    const r = rec({
      verdict: 'fix',
      factualIssues: [
        { claim: 'a', category: 'test_scores', severity: 'minor', status: 'contradicted' },
        { claim: 'b', category: 'exam_dates', status: 'unverified' },
        { claim: 'c', category: 'wording', severity: 'critical' },
        { claim: 'd' },
        { claim: 'e', category: 'other' },
        { claim: 'Срок — 1 июня', category: 'style' },
        { claim: 'f', category: 'regulations', status: '???' },
      ],
    });
    expect(r.criticalContradictions).toEqual(['a', 'f']);
    expect(r.ambiguous).toEqual(['d', 'e', 'Срок — 1 июня']);
    expect(r.unverifiedCritical).toEqual(['b', 'd', 'e', 'Срок — 1 июня']);
    expect(r.minorIssues).toEqual(['c']);
    expect(r.result).toBe('failed');
    expect(r.issues.map((i) => i.rule)).toEqual([
      'critical_category',
      'critical_category',
      'minor_category',
      'unknown_category',
      'unknown_category',
      'minor_with_marker',
      'critical_category',
    ]);
  });

  it('conservative: any factual issue blocks auto mode, whatever its category', () => {
    const minor = [{ claim: 'лучше «решать», чем «прорешивать»', category: 'wording' }];
    for (const verdict of ['pass', 'fix', 'reject'])
      expect(rec({ verdict, factualIssues: minor }).result).toBe('failed');
    // …but stays manually approvable (no critical contradiction).
    const g = evaluatePublicationGate({
      target: 'publish',
      status: 'review',
      content: C,
      reviewNotes: { factCheck: rec({ verdict: 'pass', factualIssues: minor }) },
    });
    expect(g).toMatchObject({ allowed: false, manualAllowed: true });
    expect(rec({ verdict: 'fix' }).result).toBe('failed');
  });

  it('sources are evidence: adding, removing or changing a URL changes the hash; titles, order, slash do not', () => {
    const base = {
      ...C,
      sources: [
        { title: 'ФИПИ', url: 'https://fipi.ru/ege/demoversii' },
        { title: 'Рособрнадзор', url: 'https://obrnadzor.gov.ru/ege' },
      ],
    };
    const h = articleContentHash(base);
    expect(
      articleContentHash({
        ...base,
        sources: [
          { title: 'Рособрнадзор — ЕГЭ', url: 'https://OBRNADZOR.gov.ru/ege/' },
          { title: 'ФИПИ, демоверсии', url: 'https://fipi.ru/ege/demoversii#v2027' },
        ],
      }),
    ).toBe(h);
    expect(articleContentHash({ ...base, sources: base.sources.slice(0, 1) })).not.toBe(h);
    expect(
      articleContentHash({
        ...base,
        sources: [...base.sources, { title: 'x', url: 'https://example.com/a' }],
      }),
    ).not.toBe(h);
    expect(
      articleContentHash({
        ...base,
        sources: [base.sources[0]!, { title: 'Рособрнадзор', url: 'https://obrnadzor.gov.ru/oge' }],
      }),
    ).not.toBe(h);
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
      factualIssues: [{ claim: 'x', category: 'exam_rules', status: 'contradicted' }],
    });
    expect(g({ factCheck: contradicted, manualApproval: manual })).toMatchObject({
      allowed: false,
      manualAllowed: false,
    });
  });
});
