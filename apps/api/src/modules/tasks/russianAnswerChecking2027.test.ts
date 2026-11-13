import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedRussian2027TestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * «ЕГЭ 2027 Дощинский — Русский язык» (18 variants) through the real Task
 * Engine, after the quality-audit fixes
 * (docs/reports/2026-11-russian-quality-audit.md): №8/№22 expose fields
 * А–Д and grade per part; multi-word answers are accepted in the ЕГЭ blank
 * form; accepted alternatives grade as correct; a hidden task stays hidden.
 */
describe('ЕГЭ 2027 Дощинский (18 вариантов) — answer checking via the API', () => {
  let testDb: Awaited<ReturnType<typeof createImportedRussian2027TestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createImportedRussian2027TestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function taskId(variant: number, taskNumber: number) {
    const [row] = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.source, 'Дощинский ЕГЭ 2027. Типовые экзаменационные варианты'),
          eq(schema.tasks.sourceVariant, variant),
          eq(schema.tasks.taskNumber, taskNumber),
        ),
      );
    return row!.id;
  }

  async function attempt(id: string, answer: unknown) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it.each([
    [14, 8, '62731'],
    [14, 22, '52984'],
    [15, 8, '19462'],
    [15, 22, '96183'],
    [16, 8, '98231'],
    [16, 22, '38692'],
    [17, 8, '32967'],
    [17, 22, '98216'],
    [18, 8, '38971'],
    [18, 22, '47268'],
  ])(
    'В%i №%i shows fields А–Д and grades the key all_correct, one wrong part partially',
    async (v, n, key) => {
      const id = await taskId(v, n);
      const task = (await app.inject({ method: 'GET', url: `/api/v1/tasks/${id}` })).json();
      expect(task.answerType).toBe('multi_part');
      expect(task.answerParts).toEqual([
        { id: 'a', label: 'А' },
        { id: 'b', label: 'Б' },
        { id: 'v', label: 'В' },
        { id: 'g', label: 'Г' },
        { id: 'd', label: 'Д' },
      ]);
      expect(task).not.toHaveProperty('correctAnswer');

      const answer = { a: key[0], b: key[1], v: key[2], g: key[3], d: key[4] };
      const right = await attempt(id, answer);
      expect(right).toMatchObject({ correct: true, partStatus: 'all_correct', correctParts: 5 });

      const wrong = await attempt(id, { ...answer, d: key[4] === '1' ? '2' : '1' });
      expect(wrong).toMatchObject({
        correct: false,
        partStatus: 'partially_correct',
        correctParts: 4,
      });
    },
  );

  it.each([
    [2, 25, 'стехпор', true],
    [2, 25, 'С тех пор', true],
    [2, 25, 'СТЕХПОР', true],
    [4, 25, 'близкимдалекым', false],
    [4, 25, 'близкимдалеким', true],
    [4, 25, 'далёкимблизким', true],
    [9, 25, 'оставаласьвпамяти', true],
    [9, 25, 'осталасьвпамяти', false],
    [9, 1, 'лишь', true],
    [9, 1, 'только', true],
    [15, 1, 'всравнениис', true],
    [17, 1, 'чтото', true],
    [17, 1, 'что-то', true],
    [18, 25, 'обелискпамятник', true],
    [17, 6, 'вину', true],
    [17, 6, 'ответственность', false],
    [18, 6, 'другом', true],
    [7, 21, '42', true],
  ])('В%i №%i: «%s» → correct=%s', async (v, n, answer, correct) => {
    const body = await attempt(await taskId(v, n), answer);
    expect(body.correct).toBe(correct);
  });

  it('the text of №1 shows the gap, not the answer', async () => {
    const id = await taskId(2, 1);
    const task = (await app.inject({ method: 'GET', url: `/api/v1/tasks/${id}` })).json();
    expect(task.passage.bodyMd).toContain('выходишь уже на <…> жизненное плато');
    expect(task.passage.bodyMd).not.toContain('\\n');
  });

  it('a task still on review (В2 №8) is not served', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${await taskId(2, 8)}` });
    expect(res.statusCode).toBe(404);
  });
});
