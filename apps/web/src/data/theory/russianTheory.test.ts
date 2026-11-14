import { describe, expect, it } from 'vitest';
import { parseMarkdown, type Block } from '../../ui/Theory/TheoryMarkdown.js';
import {
  hasTheory,
  loadTheoryMaterial,
  russianTheory,
  theoryForTask,
  theoryMaterialFiles,
} from './russianTheory.js';

describe('russian theory — the one source for the catalog and «Правило»', () => {
  it('covers EGE tasks 1–27 exactly once, in order', () => {
    expect(russianTheory.map((t) => t.taskNumber)).toEqual(
      Array.from({ length: 27 }, (_, i) => i + 1),
    );
  });

  it('every listed material has its file, and every file is listed', () => {
    const listed = russianTheory.flatMap((t) => t.materials.map((m) => m.id)).sort();
    expect(new Set(listed).size).toBe(listed.length);
    expect(theoryMaterialFiles().sort()).toEqual(listed);
  });

  it('a material belongs to the task its file name says', () => {
    for (const task of russianTheory) {
      for (const m of task.materials) {
        expect(m.id.startsWith(`task-${String(task.taskNumber).padStart(2, '0')}-`)).toBe(true);
      }
    }
  });

  it('every task 1–27 has a конспект and a practice', () => {
    for (let n = 1; n <= 27; n++) {
      expect(theoryForTask('russian', n)!.materials.some((m) => m.kind === 'practice')).toBe(true);
      expect(theoryForTask('russian', n)!.materials.some((m) => m.kind === 'theory')).toBe(true);
    }
  });

  it('no other subject gets a catalog (no empty stubs)', () => {
    expect(hasTheory('math')).toBe(false);
    expect(theoryForTask('math', 4)).toBeNull();
    expect(theoryForTask('russian', 99)).toBeNull();
  });

  it('loads a material lazily and keeps the recorded corrections', async () => {
    const t10 = await loadTheoryMaterial('task-10-theory');
    expect(t10).toContain('роз-/рос-: розыск, роспись.');
    expect(t10).not.toContain('расписка');
    const t18 = await loadTheoryMaterial('task-18-theory');
    expect(t18).not.toContain('Друзья, давайте, начнём');
    const t20 = await loadTheoryMaterial('task-20-theory-b');
    expect(t20).toContain('Он вернулся и, когда стемнело, лёг спать');
    await expect(loadTheoryMaterial('nope')).rejects.toThrow();
  });

  it('every конспект 1–27 is complete: an algorithm, a worked example and typical mistakes', async () => {
    const walk = (blocks: readonly Block[], out: Block[] = []): Block[] => {
      for (const b of blocks) {
        out.push(b);
        if (b.type === 'callout') walk(b.blocks, out);
      }
      return out;
    };
    for (const task of russianTheory) {
      const main = task.materials.find((m) => m.kind === 'theory')!;
      const blocks = walk(parseMarkdown(await loadTheoryMaterial(main.id)));
      const kinds = new Set(blocks.flatMap((b) => (b.type === 'callout' ? [b.kind] : [])));
      expect(blocks[0], main.id).toMatchObject({ type: 'heading', level: 1 });
      for (const kind of ['exam', 'example', 'mistake'] as const) {
        expect(kinds.has(kind), `${main.id}: ${kind}`).toBe(true);
      }
      for (const m of task.materials.filter((x) => x.kind === 'practice')) {
        expect(await loadTheoryMaterial(m.id), m.id).toMatch(/Ответ/);
      }
    }
  });

  it("describes the current FIPI formats, not the archives' old ones", async () => {
    expect(await loadTheoryMaterial('task-21-theory')).toMatch(/по одному и тому же правилу/);
    expect(await loadTheoryMaterial('task-21-practice')).not.toMatch(/Верно ли объяснены/);
    expect(await loadTheoryMaterial('task-26-theory')).toMatch(
      /связано\(-ы\) с \*\*предыдущим\*\*/,
    );
    expect(await loadTheoryMaterial('task-26-theory')).not.toMatch(/слово для пропуска/);
    const t27 = await loadTheoryMaterial('task-27-theory');
    expect(t27).toMatch(/22 балла/);
    expect(t27).toMatch(/149 слов/);
    expect(await loadTheoryMaterial('task-22-theory')).toMatch(/2 балла/);
    expect(await loadTheoryMaterial('task-08-theory')).toMatch(
      /ошибка в употреблении числительного/,
    );
  });

  it('keeps the closed editor questions closed (docs/THEORY.md)', async () => {
    const text = (id: string) => loadTheoryMaterial(id);
    expect(await text('task-05-theory')).toMatch(/\*\*отличие\*\* — то, чем одно отличается/);
    expect(await text('task-06-theory')).not.toMatch(/принимать или предпринимать/);
    expect(await text('task-06-theory')).not.toMatch(/предварительно планировать/);
    expect(await text('task-08-theory')).toContain(
      '- Неверно: *Подъезжая к станции, у меня слетела шляпа.*',
    );
    expect(await text('task-09-theory')).toMatch(/ровесник, ровня, поровну, уровень/);
    expect(await text('task-09-theory')).toMatch(/выгарки, изгарь, пригарь/);
    expect(await text('task-14-practice')).toContain('Осталось (пол) яблока');
    expect(await text('task-15-theory')).not.toMatch(/искренний — искренне/);
    expect(await text('task-15-theory')).toMatch(/нежданный, негаданный, невиданный, неслыханный/);
    expect(await text('task-16-theory')).toContain(
      '*Книги, тетради, ручки — всё лежало на столе.*',
    );
    expect(await text('task-22-theory')).not.toMatch(
      /Метафора:\*\* перенос по сходству \(`лес уснул`\)/,
    );
    expect(await text('task-22-practice')).not.toMatch(/дождь стучал в окно».\n/);
  });
});
