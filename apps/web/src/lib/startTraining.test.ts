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
  passage: null,
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
/**
 * Bugfix round 3: `unsolved`/`random`/the start task were each
 * silently broken for "По номерам" single-number sessions —
 * `listTasksByNumber`'s candidates were never filtered by solved
 * status, shuffle (when it did apply) didn't change which task the
 * session started on, and the start was picked by a SEPARATE
 * `getRandomTask` call disconnected from the final (possibly
 * shuffled/filtered) list. The pipeline is now: fetch candidates
 * (subject+number+collection scoped, `unsolved` filtering happens
 * server-side in that same call) → shuffle once if requested → start =
 * `orderedTasks[0]` — never a second API call just to pick the start.
 */
describe('resolveSingleNumberSession (navigation bugfix round 3: unsolved filter, real shuffle, start = orderedTasks[0])', () => {
  function variantTask(variant: number, taskNumber: number) {
    return { ...TASK, id: `v${variant}-task-${taskNumber}`, taskNumber };
  }

  it('Test 1: unseen=false, random=false → full list, original order, listTasksByNumber called with unsolved=false', async () => {
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
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined, false);
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('Test 2: unseen=true, random=false → only unsolved candidates (filtering happens server-side via listTasksByNumber)', async () => {
    // Server already excludes V1/V3 (correctly solved) — the function
    // never re-filters client-side, it trusts what the API returns.
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(2, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: true,
    });
    if ('error' in result) throw new Error('expected success');
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined, true);
    expect(result.tasks.map((t) => t.id)).toEqual(['v2-task-13', 'v4-task-13', 'v5-task-13']);
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('Test 3: unseen=false, random=true → all tasks, but order is really shuffled', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    // Math.random mocked to 0 makes Fisher-Yates always swap the
    // current element with index 0 — a deterministic, verifiable
    // reordering rather than "trust it's shuffled".
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await resolveSingleNumberSession(
      { subject: 'math', taskNumber: 13, random: true, unseen: false },
      { shuffleOrder: true },
    );
    randomSpy.mockRestore();
    if ('error' in result) throw new Error('expected success');
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.map((t) => t.id)).not.toEqual([
      'v1-task-13',
      'v2-task-13',
      'v3-task-13',
      'v4-task-13',
      'v5-task-13',
    ]);
    expect(new Set(result.tasks.map((t) => t.id))).toEqual(
      new Set(['v1-task-13', 'v2-task-13', 'v3-task-13', 'v4-task-13', 'v5-task-13']),
    );
  });

  it('Test 4: unseen=true, random=true → filter happens first (server-side), THEN shuffle applies to the filtered list', async () => {
    // Only V2/V4/V5 are unsolved — the server already returns just
    // these three; shuffle must reorder exactly this filtered set,
    // never reach back for V1/V3.
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(2, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await resolveSingleNumberSession(
      { subject: 'math', taskNumber: 13, random: true, unseen: true },
      { shuffleOrder: true },
    );
    randomSpy.mockRestore();
    if ('error' in result) throw new Error('expected success');
    expect(result.tasks).toHaveLength(3);
    expect(new Set(result.tasks.map((t) => t.id))).toEqual(
      new Set(['v2-task-13', 'v4-task-13', 'v5-task-13']),
    );
    // Test 6/7 cover that startTaskId is always orderedTasks[0] — here
    // just confirm it's one of the real filtered candidates.
    expect(['v2-task-13', 'v4-task-13', 'v5-task-13']).toContain(result.startTaskId);
  });

  it('Test 5: unseen=true with nothing left after filtering fails with no_unseen_tasks, never a fallback to a solved task', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: true,
    });
    if (!('error' in result)) throw new Error('expected an error result');
    expect(result.error.reason).toBe('no_unseen_tasks');
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('an empty list with unseen=false fails with a generic reason (never invents a task)', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if (!('error' in result)) throw new Error('expected an error result');
    expect(result.error.reason).toBe('none');
  });

  it('Test 6: without shuffle, start is always orderedTasks[0] (V1, not a random pick)', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
    ]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if ('error' in result) throw new Error('expected success');
    expect(result.startTaskId).toBe(result.tasks[0]!.id);
    expect(result.startTaskId).toBe('v1-task-13');
  });

  it('Test 7: with shuffle, start is orderedTasks[0] of the SHUFFLED list, not a separately-picked random task', async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await resolveSingleNumberSession(
      { subject: 'math', taskNumber: 13, random: false, unseen: false },
      { shuffleOrder: true },
    );
    randomSpy.mockRestore();
    if ('error' in result) throw new Error('expected success');
    expect(result.startTaskId).toBe(result.tasks[0]!.id);
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it("Test 8: the resolved ids/order are exactly this one call's result — never re-rolled or re-fetched afterward", async () => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 13), variantTask(2, 13)]);
    const result = await resolveSingleNumberSession({
      subject: 'math',
      taskNumber: 13,
      random: false,
      unseen: false,
    });
    if ('error' in result) throw new Error('expected success');
    expect(api.listTasksByNumber).toHaveBeenCalledTimes(1);
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
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined, false);
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
    expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, 'ege-2026-yashchenko', false);
  });
});
