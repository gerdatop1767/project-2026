import { describe, expect, it } from 'vitest';
import { libraryFiles, libraryItems, loadLibraryText } from './library.js';
import { theoryMaterialFiles } from '../theory/russianTheory.js';
import { theoryFigureIds } from '../../ui/Theory/figures/TheoryFigure.js';
import { parseMarkdown, type Block } from '../../ui/Theory/TheoryMarkdown.js';

function walk(blocks: readonly Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.type === 'callout') walk(b.blocks, out);
  }
  return out;
}

describe('learning-centre library', () => {
  it('ids are unique; every own text has a file and every file is listed', () => {
    const ids = libraryItems.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const own = libraryItems.filter((x) => !x.theoryFile).map((x) => x.id);
    expect([...libraryFiles()].sort()).toEqual([...own].sort());
  });

  it('reused theory files exist — the lists are not copied', () => {
    for (const x of libraryItems.filter((i) => i.theoryFile)) {
      expect(theoryMaterialFiles()).toContain(x.theoryFile);
      expect(libraryFiles()).not.toContain(x.id);
    }
  });

  it('both sections and both subjects are covered; every card has a title, topic and description', () => {
    const count = (section: string, subject: string) =>
      libraryItems.filter((x) => x.section === section && x.subject === subject).length;
    expect(count('materials', 'math')).toBeGreaterThanOrEqual(10);
    expect(count('materials', 'russian')).toBeGreaterThanOrEqual(10);
    expect(libraryItems.filter((x) => x.section === 'strategies').length).toBeGreaterThanOrEqual(9);
    for (const subject of ['math', 'russian', 'general']) {
      expect(count('strategies', subject), subject).toBeGreaterThan(0);
    }
    for (const x of libraryItems) {
      expect(x.title.length, x.id).toBeGreaterThan(10);
      expect(x.topic.length, x.id).toBeGreaterThan(2);
      expect(x.description.length, x.id).toBeGreaterThan(50);
      for (const n of x.tasks ?? []) expect(n >= 1 && n <= 27, x.id).toBe(true);
    }
  });

  it('every text is a real page: a heading, structure, a table or callout, known drawings, closed formulas', async () => {
    for (const x of libraryItems) {
      const source = await loadLibraryText(x);
      const blocks = walk(parseMarkdown(source));
      expect(blocks[0], x.id).toMatchObject({ type: 'heading', level: 1 });
      expect(source.length, x.id).toBeGreaterThan(1500);
      // Own pages need tables or callouts; a reused FIPI list is a plain list by nature.
      if (!x.theoryFile) {
        expect(
          blocks.some((b) => b.type === 'table' || b.type === 'callout'),
          x.id,
        ).toBe(true);
      }
      // The bison speaks rarely: at most one tip per page.
      expect(
        blocks.filter((b) => b.type === 'callout' && b.kind === 'tip').length,
        x.id,
      ).toBeLessThanOrEqual(1);
      for (const b of blocks) {
        if (b.type === 'figure') expect(theoryFigureIds, `${x.id}: ${b.id}`).toContain(b.id);
      }
      for (const line of source.split('\n')) {
        if (line.trim().startsWith('$$')) continue;
        expect((line.match(/\$/g) ?? []).length % 2, `${x.id}: ${line}`).toBe(0);
      }
      expect(source, x.id).not.toContain('```');
    }
  });
});
