import { describe, expect, it, vi } from 'vitest';
import { resolveSingleNumberSession, startCustomVariant, startRealTask } from './startTraining.js';
import * as api from './api.js';

vi.mock('./api.js', () => {
  class MockApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API request failed with status ${status}`);
    }
  }
  return { getRandomTask: vi.fn(), listTasksByNumber: vi.fn(), ApiError: MockApiError };
});

const TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 7,
  topicId: null,
  topicName: null,
  difficulty: 2 as const,
  conditionMd: 'Условие',
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerOptions: null,
  answerParts: null,
  source: 'Ященко',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

describe('startRealTask', () => {
  it('forwards subject/taskNumber/collection to getRandomTask', () => {
    vi.mocked(api.getRandomTask).mockResolvedValue(TASK);
    const navigate = vi.fn();
    startRealTask(navigate, { subject: 'math', taskNumber: 7, collection: 'ege-2026-yashchenko' });
    expect(api.getRandomTask).toHaveBeenCalledWith({
      subject: 'math',
      taskNumber: 7,
      collection: 'ege-2026-yashchenko',
    });
  });

  it('carries the collection into the navigated task route as collectionSlug', async () => {
    vi.mocked(api.getRandomTask).mockResolvedValue(TASK);
    const navigate = vi.fn();
    startRealTask(navigate, { subject: 'math', collection: 'ege-2026-yashchenko' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({
      screen: 'task',
      subjectId: 'math',
      taskNumber: 7,
      taskId: 'task-1',
      collectionSlug: 'ege-2026-yashchenko',
    });
  });

  it('leaves collectionSlug undefined when no collection was given (Общий банк)', async () => {
    vi.mocked(api.getRandomTask).mockResolvedValue(TASK);
    const navigate = vi.fn();
    startRealTask(navigate, { subject: 'math' });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ screen: 'task', collectionSlug: undefined }),
    );
  });
});

describe('startCustomVariant (Task Workspace block — fixes "Варианты → Общие → сформировать вариант" dropping every number but the first)', () => {
  it('resolves every picked number (not just the first) and carries the whole list as customOrderedTasks', async () => {
    vi.mocked(api.getRandomTask).mockImplementation(({ taskNumber }) =>
      Promise.resolve({ ...TASK, id: `task-${taskNumber}`, taskNumber: taskNumber! }),
    );
    const navigate = vi.fn();
    startCustomVariant(navigate, {
      subject: 'math',
      taskNumbers: [1, 3, 4, 7, 10, 15, 19],
      collection: 'ege-2026-yashchenko',
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(api.getRandomTask).toHaveBeenCalledTimes(7);
    expect(navigate).toHaveBeenCalledWith({
      screen: 'task',
      subjectId: 'math',
      taskNumber: 1,
      taskId: 'task-1',
      collectionSlug: 'ege-2026-yashchenko',
      customOrderedTasks: [
        { taskId: 'task-1', taskNumber: 1 },
        { taskId: 'task-3', taskNumber: 3 },
        { taskId: 'task-4', taskNumber: 4 },
        { taskId: 'task-7', taskNumber: 7 },
        { taskId: 'task-10', taskNumber: 10 },
        { taskId: 'task-15', taskNumber: 15 },
        { taskId: 'task-19', taskNumber: 19 },
      ],
      returnTo: undefined,
    });
  });

  it('never navigates when nothing was picked', () => {
    const navigate = vi.fn();
    startCustomVariant(navigate, { subject: 'math', taskNumbers: [] });
    expect(navigate).not.toHaveBeenCalled();
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });
});

/**
 * Navigation bugfix: "По номерам" with exactly ONE number selected
 * must build its navigation list from every variant's copy of that
 * number (V1#N, V2#N, ...), never a single random pick — see the
 * function's own doc comment for the full "1 of 1" bug history.
 */
describe('resolveSingleNumberSession (navigation bugfix: real multi-variant list for one number)', () => {
  function variantTask(variant: number, taskNumber: number) {
    return { ...TASK, id: `v${variant}-task-${taskNumber}`, taskNumber };
  }

  it('Test 1: session length 5, all entries share taskNumber 13, built from listTasksByNumber', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if ('error' in result) throw new Error('expected success');
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.every((t) => t.taskNumber === 13)).toBe(true);
    expect(result.tasks.map((t) => t.id)).toEqual([
      'v1-task-13',
      'v2-task-13',
      'v3-task-13',
      'v4-task-13',
      'v5-task-13',
    ]);
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined);
  });

  it('Test 2-4: V1 is first (no previous), V5 is last (no next), each step is the adjacent variant', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if ('error' in result) throw new Error('expected success');
    // Default (no unseen refinement) starts on the first entry — V1#13.
    expect(result.startTaskId).toBe('v1-task-13');
    const ids = result.tasks.map((t) => t.id);
    expect(ids.indexOf('v1-task-13')).toBe(0);
    expect(ids.indexOf('v3-task-13')).toBe(2);
    expect(ids[ids.indexOf('v3-task-13') - 1]).toBe('v2-task-13');
    expect(ids[ids.indexOf('v3-task-13') + 1]).toBe('v4-task-13');
    expect(ids.indexOf('v5-task-13')).toBe(4);
  });

  it("never re-rolls on each call — the resolved ids are exactly listTasksByNumber's result, fixed at session start", async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 13), variantTask(2, 13)]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if ('error' in result) throw new Error('expected success');
    expect(api.getRandomTask).not.toHaveBeenCalled();
    expect(result.tasks.map((t) => t.id)).toEqual(['v1-task-13', 'v2-task-13']);
  });

  it('random: true ignores the selected Сборник when building the list', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 13)]);
    await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      collection: 'ege-2026-yashchenko',
      random: true,
      unseen: false,
    });
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined);
  });

  it('random: false keeps the selected Сборник scope', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 13)]);
    await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      collection: 'ege-2026-yashchenko',
      random: false,
      unseen: false,
    });
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, 'ege-2026-yashchenko');
  });

  it('unseen: true starts on the real unseen pick, not just the first entry', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
    ]);
    vi.mocked(api.getRandomTask).mockResolvedValue(variantTask(3, 13));
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: true,
    });
    if ('error' in result) throw new Error('expected success');
    expect(api.getRandomTask).toHaveBeenCalledWith({
      subject: 'math',
      taskNumber: 13,
      collection: undefined,
      unseen: true,
    });
    expect(result.startTaskId).toBe('v3-task-13');
    // The full list is still all 3 — unseen only picks the start, never shrinks the list.
    expect(result.tasks).toHaveLength(3);
  });

  it('unseen: true with no unseen task left fails with no_unseen_tasks, never starting on an already-solved one', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 13)]);
    vi.mocked(api.getRandomTask).mockRejectedValue(
      new api.ApiError(404, { error: 'no_unseen_tasks' }),
    );
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: true,
    });
    if (!('error' in result)) throw new Error('expected an error result');
    expect(result.error.reason).toBe('no_unseen_tasks');
  });

  it('an empty list (no published task has this number) fails instead of inventing one', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if (!('error' in result)) throw new Error('expected an error result');
    expect(result.error.reason).toBe('none');
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('shuffleOrder reorders the session list (still every entry, still fixed, not re-rolled)', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
    ]);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await resolveSingleNumberSession(
      { subject: 'math', taskNumber: 13, random: false, unseen: false },
      { shuffleOrder: true },
    );
    randomSpy.mockRestore();
    if ('error' in result) throw new Error('expected success');
    expect(result.tasks).toHaveLength(3);
    expect(new Set(result.tasks.map((t) => t.id))).toEqual(
      new Set(['v1-task-13', 'v2-task-13', 'v3-task-13']),
    );
  });
});
