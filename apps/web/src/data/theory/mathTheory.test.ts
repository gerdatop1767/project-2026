import { describe, expect, it } from 'vitest';
import { EXAM_TOPICS, examNumbersForTopic } from '@zybrilka/shared';
import {
  examNumbersLabel,
  loadMathTheory,
  mathTheory,
  mathTheoryCatalog,
  mathTheoryFiles,
} from './mathTheory.js';
import { theoryFigureIds } from '../../ui/Theory/figures/TheoryFigure.js';
import { parseMarkdown, type Block } from '../../ui/Theory/TheoryMarkdown.js';

function walk(blocks: readonly Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.type === 'callout') walk(b.blocks, out);
  }
  return out;
}

describe('math theory manifest', () => {
  it('every material has its file and every file is in the manifest', () => {
    expect([...mathTheoryFiles()].sort()).toEqual(mathTheory.map((m) => m.file).sort());
  });

  it('materials belong to real math topics, at most one per topic', () => {
    const keys = mathTheory.map((m) => m.topicKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(EXAM_TOPICS.find((t) => t.key === key)?.subjectId).toBe('math');
      expect(examNumbersForTopic(key).length).toBeGreaterThan(0);
    }
    expect(mathTheoryCatalog()).toHaveLength(
      EXAM_TOPICS.filter((t) => t.subjectId === 'math').length,
    );
  });

  it('every source is named and says what it confirms; links are https', () => {
    for (const m of mathTheory) {
      expect(m.sources.length).toBeGreaterThan(0);
      for (const s of m.sources) {
        expect(s.title.length).toBeGreaterThan(5);
        expect(s.confirms.length).toBeGreaterThan(10);
        if (s.url) expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('each text has a title, sections, a check-yourself part and only known drawings', async () => {
    for (const m of mathTheory) {
      const source = await loadMathTheory(m.file);
      const blocks = walk(parseMarkdown(source));
      expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
      expect(blocks.filter((b) => b.type === 'heading' && b.level === 2).length).toBeGreaterThan(4);
      expect(blocks.some((b) => b.type === 'callout' && b.kind === 'exam')).toBe(true);
      expect(blocks.some((b) => b.type === 'callout' && b.kind === 'mistake')).toBe(true);
      for (const b of blocks) {
        if (b.type === 'figure') expect(theoryFigureIds, `${m.file}: ${b.id}`).toContain(b.id);
      }
      // Every inline formula is closed: an odd number of `$` on a line
      // would show raw TeX.
      for (const line of source.split('\n')) {
        if (line.trim().startsWith('$$')) continue;
        expect((line.match(/\$/g) ?? []).length % 2, `${m.file}: ${line}`).toBe(0);
      }
    }
  });

  it('the label names every edition, merging 2027 and 2026 when their numbers coincide', () => {
    expect(examNumbersLabel('math.finance')).toBe(
      'ЕГЭ-2027 и ЕГЭ-2026 №16 · Ященко-2027, старая редакция №13',
    );
    expect(examNumbersLabel('math.random-variables')).toBe('Ященко-2027, старая редакция №6');
    expect(examNumbersLabel('math.derivative-investigation')).toBe(
      'ЕГЭ-2027 и ЕГЭ-2026 №12 · Ященко-2027, старая редакция №9',
    );
  });
});
