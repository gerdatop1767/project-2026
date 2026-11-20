import { schema, type Database } from '@zybrilka/db';
import { inArray } from 'drizzle-orm';
import { STRESS_GAME_ID } from './stress.js';
import { isQuizGame, quizBank } from './quiz.js';

export interface ItemLabel {
  /** The question as the player saw it (shortened). */
  text: string;
  /** Its right answer. */
  answer: string;
}

const short = (s: string, n = 160) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/**
 * What a question of a mini-game says, for the admin report: a word of
 * «Ударения» or a quiz question from the game's bank. An id no longer in
 * the bank (a task unpublished since) is left out — the report says so.
 */
export async function miniGameItemLabels(
  db: Database,
  gameId: string,
  ids: readonly string[],
): Promise<Map<string, ItemLabel>> {
  const out = new Map<string, ItemLabel>();
  if (ids.length === 0) return out;
  if (gameId === STRESS_GAME_ID) {
    const words = await db
      .select({
        id: schema.stressWords.id,
        word: schema.stressWords.word,
        marked: schema.stressWords.marked,
      })
      .from(schema.stressWords)
      .where(inArray(schema.stressWords.id, [...ids]));
    for (const w of words) out.set(w.id, { text: w.word, answer: w.marked });
    return out;
  }
  if (!isQuizGame(gameId)) return out;
  const bank = await quizBank(db, gameId);
  for (const id of ids) {
    const item = bank.byId.get(id);
    if (item) {
      out.set(id, {
        text: short(item.prompt ? `${item.prompt} — ${item.text}` : item.text),
        answer: short(item.display, 80),
      });
    }
  }
  return out;
}
