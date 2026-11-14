import { describe, expect, it } from 'vitest';
import { EXAM_TASK_SPECS, EXAM_TOPICS, examNumbersForTopic } from '@zybrilka/shared';
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

  it('part 1 is covered in every edition: each number has written theory for each of its topics', () => {
    for (const spec of EXAM_TASK_SPECS.filter((x) => x.subjectId === 'math' && x.part === 1)) {
      for (const b of spec.topics) {
        expect(
          mathTheory.some((m) => m.topicKey === b.topicKey),
          `${spec.edition} №${spec.number}: ${b.topicKey}`,
        ).toBe(true);
      }
    }
  });

  it('part 2 is covered in every edition with full material: methods, worked examples, practice with answers', async () => {
    const part2 = EXAM_TASK_SPECS.filter((x) => x.subjectId === 'math' && x.part === 2);
    // ЕГЭ-2027/2026 №13–19 and the old Ященко №14–20.
    expect(part2.filter((x) => x.edition === 'ege-2027').map((x) => x.number)).toEqual([
      13, 14, 15, 16, 17, 18, 19,
    ]);
    const keys = new Set(part2.flatMap((x) => x.topics.map((b) => b.topicKey)));
    for (const key of keys) {
      const material = mathTheory.find((m) => m.topicKey === key);
      expect(material, key).toBeDefined();
      const source = await loadMathTheory(material!.file);
      const blocks = walk(parseMarkdown(source));
      const h2 = blocks.filter((b) => b.type === 'heading' && b.level === 2);
      expect(h2.length, key).toBeGreaterThanOrEqual(7);
      expect(
        blocks.filter((b) => b.type === 'callout' && b.kind === 'example').length,
        key,
      ).toBeGreaterThanOrEqual(3);
      expect(source, key).toMatch(/## \d+\. Потренируйся/);
      expect(source, key).toContain('**Ответы.**');
      expect(source.length, key).toBeGreaterThan(5000);
    }
    // The tasks where a drawing is the method get drawings.
    for (const file of [
      'equations-advanced',
      'stereometry-proof',
      'inequalities',
      'planimetry-proof',
      'parameters',
    ]) {
      const blocks = walk(parseMarkdown(await loadMathTheory(file)));
      expect(
        blocks.some((b) => b.type === 'figure'),
        file,
      ).toBe(true);
    }
  });

  it('the «where on the exam» lines of every text agree with the numbering tables', async () => {
    const firstNumber = (line: string | undefined) =>
      /(?:задание|тоже) №(\d+)/.exec(line ?? '')?.[1] ?? null;
    for (const m of mathTheory) {
      const lines = (await loadMathTheory(m.file)).split('\n');
      const current = lines.find((l) => l.startsWith('- **ЕГЭ-2027 и ЕГЭ-2026**'));
      const old = lines.find((l) => l.startsWith('- **Старый сборник Ященко-2027**'));
      expect(current, m.file).toBeDefined();
      expect(old, m.file).toBeDefined();
      const at = examNumbersForTopic(m.topicKey).filter((x) => x.relation !== 'part-of');
      const num = (edition: string) => at.find((x) => x.edition === edition)?.number ?? null;
      // ЕГЭ-2027 and ЕГЭ-2026 share one line, so their numbers must coincide.
      expect(num('ege-2027'), m.file).toBe(num('ege-2026'));
      expect(firstNumber(current), m.file).toBe(num('ege-2027')?.toString() ?? null);
      expect(firstNumber(old), m.file).toBe(num('ege-2027-project')?.toString() ?? null);
    }
  });
});
