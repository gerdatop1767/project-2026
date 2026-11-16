import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviceForSkill, examSkillInfo, numberCards } from '@zybrilka/shared';
import { mathMaterialFor } from './mathTheory.js';
import { russianTheory } from './russianTheoryData.js';

const contentDir = resolve(__dirname, '../../content/theory') + '/';

/** Headings (##, ###) of the theory page a skill's advice opens. */
function headingsOf(skill: string): string[] {
  const info = examSkillInfo(skill)!;
  let file: string;
  if (info.subjectId === 'math') {
    const material = mathMaterialFor(skill);
    expect(material, `${skill}: no math theory`).not.toBeNull();
    file = `math/${material!.file}.md`;
  } else {
    expect(
      russianTheory.some((t) => t.taskNumber === info.examNumber),
      skill,
    ).toBe(true);
    file = `russian/task-${String(info.examNumber).padStart(2, '0')}-theory.md`;
  }
  const md = readFileSync(contentDir + file, 'utf8');
  return [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!.trim());
}

describe('advice links only to theory that exists', () => {
  it('every card section and every part section is a real heading of its theory page', () => {
    for (const card of numberCards()) {
      const headings = headingsOf(card.skill);
      for (const h of card.theory) expect(headings, `${card.skill}: «${h}»`).toContain(h);
      for (const part of card.parts?.items ?? []) {
        for (const h of part.theory)
          expect(headings, `${card.skill}/${part.key}: «${h}»`).toContain(h);
      }
      expect(adviceForSkill(card.skill, 'forgetting').linksTheory).toBe(true);
    }
  });
});
