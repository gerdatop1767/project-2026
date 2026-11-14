import { describe, expect, it } from 'vitest';
import {
  highlightParts,
  loadAllTexts,
  plainText,
  queryTokens,
  searchEntries,
  searchLearning,
} from './learningSearch.js';
import { libraryItems } from './library/library.js';
import { pathForRoute } from '../lib/routes.js';

const keys = (q: string, o?: Parameters<typeof searchLearning>[1]) =>
  searchLearning(q, o).map((r) => r.entry.key);

describe('learning-centre search', () => {
  it('indexes the theory of both subjects and the whole library, each with a working link', () => {
    const entries = searchEntries();
    expect(entries.filter((e) => e.kind === 'theory' && e.subject === 'russian')).toHaveLength(27);
    expect(entries.filter((e) => e.kind === 'theory' && e.subject === 'math').length).toBe(21);
    expect(entries.filter((e) => e.kind !== 'theory')).toHaveLength(libraryItems.length);
    for (const e of entries)
      expect(pathForRoute(e.route), e.key).toMatch(/^\/(theory|materials|strategies)/);
  });

  it('finds by title, description, topic, subject and task number', () => {
    expect(keys('производных')[0]).toBe('library:math-derivatives');
    expect(keys('аннуитет')).toContain('library:math-finance'); // description
    expect(keys('пунктуация')).toContain('library:ru-punctuation-simple'); // topic
    expect(keys('стратегии математика')).toContain('library:strategy-time-math'); // kind + subject
    expect(keys('№15')).toContain('ru:15');
    expect(keys('15')).toContain('math:math.inequalities');
    // The old Ященко numbering does not leak into the current numbers.
    expect(keys('16')).not.toContain('math:math.inequalities');
  });

  it('every word must match; «ё» and case do not matter', () => {
    expect(keys('Таблица ПРОИЗВОДНЫХ')).toContain('library:math-derivatives');
    expect(keys('свёкла').length).toBe(keys('свекла').length);
    expect(keys('производных зубрилкаслово')).toEqual([]);
  });

  it('filters by subject and by kind', () => {
    expect(
      searchLearning('ошибки', { subject: 'russian' }).every((r) => r.entry.subject === 'russian'),
    ).toBe(true);
    expect(
      searchLearning('время', { kinds: ['strategy'] }).every((r) => r.entry.kind === 'strategy'),
    ).toBe(true);
  });

  it('searches inside the texts once they are loaded and returns a snippet around the match', async () => {
    expect(keys('нижний')).not.toContain('library:math-integrals');
    await loadAllTexts();
    const hit = searchLearning('нижний').find((r) => r.entry.key === 'library:math-integrals');
    expect(hit?.snippet).toMatch(/нижний/);
    // Theory texts are searched too.
    expect(keys('выгарки')).toContain('ru:9');
    expect(keys('рационализации')).toContain('math:math.inequalities');
  });

  it('highlights every occurrence, without changing the text', () => {
    const parts = highlightParts('Ёлка и елка', 'елк');
    expect(parts.map((p) => p.text).join('')).toBe('Ёлка и елка');
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Ёлк', 'елк']);
    expect(queryTokens('№ 8, и')).toEqual(['8']);
    expect(plainText('> [!tip] Совет\n> **Да** $x^2$')).toBe('Совет Да x^2');
  });
});
