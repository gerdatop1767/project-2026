import { describe, expect, it } from 'vitest';
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

  it('tasks 1 and 2 honestly have nothing yet; 3–27 have a конспект', () => {
    expect(theoryForTask('russian', 1)!.materials).toEqual([]);
    expect(theoryForTask('russian', 2)!.materials).toEqual([]);
    for (let n = 3; n <= 27; n++) {
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
});
