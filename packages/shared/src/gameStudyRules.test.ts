import { describe, expect, it } from 'vitest';
import { GAME_STUDY_RULES, gameStudyRule } from './gameStudyRules.js';
import { MINI_GAMES } from './miniGames.js';

describe('«Правила» — study material of every mini-game', () => {
  it('every game has its own rule, and no rule is left without a game', () => {
    for (const g of MINI_GAMES) expect(gameStudyRule(g.id), g.id).toBeDefined();
    expect(Object.keys(GAME_STUDY_RULES).sort()).toEqual(MINI_GAMES.map((g) => g.id).sort());
  });

  it('each rule has all seven parts filled in', () => {
    for (const [id, r] of Object.entries(GAME_STUDY_RULES)) {
      expect(r.title, id).not.toBe('');
      expect(r.when.length, id).toBeGreaterThan(20);
      expect(r.cases.length, id).toBeGreaterThan(0);
      for (const c of r.cases)
        expect(Boolean(c.text || c.points?.length || c.table), `${id}: ${c.title}`).toBe(true);
      expect(r.exceptions.length, id).toBeGreaterThan(0);
      expect(r.examples.length, id).toBeGreaterThan(0);
      expect(r.mistakes.length, id).toBeGreaterThan(0);
      expect(r.memo.length, id).toBeGreaterThan(0);
    }
  });

  it('tables are rectangular and bold marks are balanced', () => {
    for (const [id, r] of Object.entries(GAME_STUDY_RULES)) {
      for (const c of r.cases)
        for (const row of c.table?.rows ?? [])
          expect(row.length, `${id}: ${c.title}`).toBe(c.table!.head.length);
      const all = JSON.stringify(r);
      expect((all.match(/\*\*/g) ?? []).length % 2, id).toBe(0);
    }
  });

  it('no two games share one text — each teaches its own task', () => {
    const titles = Object.values(GAME_STUDY_RULES).map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
