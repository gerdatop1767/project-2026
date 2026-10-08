import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useTaskNavigation } from './useTaskNavigation.js';
import { NavigationProvider, useNavigation } from './navigation.js';
import * as api from './api.js';

vi.mock('./api.js', () => ({
  getVariant: vi.fn(),
  getVariantForTask: vi.fn(),
}));

const TASK_A = { taskId: 'task-a', taskNumber: 11 };
const TASK_B = { taskId: 'task-b', taskNumber: 12 };
const TASK_C = { taskId: 'task-c', taskNumber: 14 };
const TASK_D = { taskId: 'task-d', taskNumber: 17 };

function variantDetail(tasks: { taskId: string; taskNumber: number }[]) {
  return {
    variant: {
      id: 'variant-1',
      collectionId: 'col-1',
      variantNumber: 1,
      title: 'Вариант 1',
      year: null,
    },
    collection: {
      id: 'col-1',
      subjectId: 'math',
      slug: 'ege-2026-yashchenko',
      title: 'Ященко',
      publisher: null,
      year: null,
      description: null,
    },
    tasks: tasks.map((t, i) => ({
      position: i + 1,
      task: {
        id: t.taskId,
        subjectId: 'math',
        taskNumber: t.taskNumber,
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
      },
    })),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(NavigationProvider, null, children);
}

describe('useTaskNavigation', () => {
  it('has no ordered context (loading false, empty list) when neither collectionSlug nor variantId is given', () => {
    const { result } = renderHook(
      () => useTaskNavigation({ subjectId: 'math', taskId: TASK_A.taskId }),
      { wrapper },
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.orderedTasks).toEqual([]);
    expect(result.current.previous).toBeNull();
    expect(result.current.next).toBeNull();
  });

  it('resolves the ordered list via collectionSlug (GET /variants/for-task)', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(
      variantDetail([TASK_A, TASK_B, TASK_C, TASK_D]),
    );
    const { result } = renderHook(
      () =>
        useTaskNavigation({
          subjectId: 'math',
          taskId: TASK_B.taskId,
          collectionSlug: 'ege-2026-yashchenko',
        }),
      { wrapper },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getVariantForTask).toHaveBeenCalledWith(TASK_B.taskId, 'ege-2026-yashchenko');
    expect(result.current.orderedTasks.map((t) => t.taskNumber)).toEqual([11, 12, 14, 17]);
    expect(result.current.previous).toEqual(TASK_A);
    expect(result.current.next).toEqual(TASK_C);
  });

  it('resolves the ordered list directly via an already-known variantId (GET /variants/:id)', async () => {
    vi.mocked(api.getVariant).mockResolvedValue(variantDetail([TASK_A, TASK_B]));
    const { result } = renderHook(
      () =>
        useTaskNavigation({
          subjectId: 'math',
          taskId: TASK_A.taskId,
          variantId: 'variant-1',
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getVariant).toHaveBeenCalledWith('variant-1');
    expect(api.getVariantForTask).not.toHaveBeenCalled();
    expect(result.current.variantId).toBe('variant-1');
  });

  it('previous is null at the start of the ordered list', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(variantDetail([TASK_A, TASK_B]));
    const { result } = renderHook(
      () => useTaskNavigation({ subjectId: 'math', taskId: TASK_A.taskId, collectionSlug: 'slug' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.previous).toBeNull();
    expect(result.current.next).toEqual(TASK_B);
  });

  it('next is null at the end of the ordered list', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(variantDetail([TASK_A, TASK_B]));
    const { result } = renderHook(
      () => useTaskNavigation({ subjectId: 'math', taskId: TASK_B.taskId, collectionSlug: 'slug' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.previous).toEqual(TASK_A);
    expect(result.current.next).toBeNull();
  });

  it('both previous and next are null when the list has only one task', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(variantDetail([TASK_A]));
    const { result } = renderHook(
      () => useTaskNavigation({ subjectId: 'math', taskId: TASK_A.taskId, collectionSlug: 'slug' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.previous).toBeNull();
    expect(result.current.next).toBeNull();
  });

  it('falls back to an empty list (never a crash) when resolution fails — unknown source or task not in any variant', async () => {
    vi.mocked(api.getVariantForTask).mockRejectedValue(new Error('404'));
    const { result } = renderHook(
      () =>
        useTaskNavigation({ subjectId: 'math', taskId: TASK_A.taskId, collectionSlug: 'unknown' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orderedTasks).toEqual([]);
    expect(result.current.previous).toBeNull();
    expect(result.current.next).toBeNull();
  });

  it('handles gap task numbers (11,12,14,17) correctly without ever inventing 13', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(
      variantDetail([TASK_A, TASK_B, TASK_C, TASK_D]),
    );
    const { result } = renderHook(
      () => useTaskNavigation({ subjectId: 'math', taskId: TASK_C.taskId, collectionSlug: 'slug' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orderedTasks.map((t) => t.taskNumber)).not.toContain(13);
    expect(result.current.previous).toEqual(TASK_B);
    expect(result.current.next).toEqual(TASK_D);
  });

  it('goTo navigates preserving subject/collectionSlug/resolved variantId', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(variantDetail([TASK_A, TASK_B]));
    let navigatedRoute: unknown = null;
    function Probe() {
      const { overlay } = useNavigation();
      navigatedRoute = overlay;
      return null;
    }
    const { result } = renderHook(
      () =>
        useTaskNavigation({
          subjectId: 'math',
          taskId: TASK_A.taskId,
          collectionSlug: 'ege-2026-yashchenko',
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(NavigationProvider, null, children, createElement(Probe)),
      },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.goTo(TASK_B);
    await waitFor(() =>
      expect((navigatedRoute as { taskId?: string } | null)?.taskId).toBe(TASK_B.taskId),
    );
    expect(navigatedRoute).toMatchObject({
      screen: 'task',
      subjectId: 'math',
      taskNumber: TASK_B.taskNumber,
      taskId: TASK_B.taskId,
      collectionSlug: 'ege-2026-yashchenko',
      variantId: 'variant-1',
    });
  });

  describe('customOrderedTasks (Task Workspace block — a user-assembled variant with no real variants row)', () => {
    const CUSTOM_LIST = [TASK_A, TASK_C, TASK_D]; // 11, 14, 17 — a subset, not 11..19

    it('uses the list directly — no fetch, not loading, exactly the picked numbers (never taskNumber ± 1)', () => {
      const { result } = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: TASK_C.taskId,
            customOrderedTasks: CUSTOM_LIST,
          }),
        { wrapper },
      );
      expect(result.current.loading).toBe(false);
      expect(api.getVariant).not.toHaveBeenCalled();
      expect(api.getVariantForTask).not.toHaveBeenCalled();
      expect(result.current.orderedTasks).toEqual(CUSTOM_LIST);
      expect(result.current.orderedTasks.map((t) => t.taskNumber)).toEqual([11, 14, 17]);
      // real prev/next from the list, not ±1 (13/15 are not in the list)
      expect(result.current.previous).toEqual(TASK_A);
      expect(result.current.next).toEqual(TASK_D);
    });

    it('goTo carries the same customOrderedTasks forward, not a resolved variantId', async () => {
      let navigatedRoute: unknown = null;
      function Probe() {
        const { overlay } = useNavigation();
        navigatedRoute = overlay;
        return null;
      }
      const { result } = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: TASK_A.taskId,
            customOrderedTasks: CUSTOM_LIST,
          }),
        {
          wrapper: ({ children }: { children: ReactNode }) =>
            createElement(NavigationProvider, null, children, createElement(Probe)),
        },
      );
      result.current.goTo(TASK_C);
      await waitFor(() =>
        expect((navigatedRoute as { taskId?: string } | null)?.taskId).toBe(TASK_C.taskId),
      );
      expect(navigatedRoute).toMatchObject({
        screen: 'task',
        taskId: TASK_C.taskId,
        variantId: undefined,
        customOrderedTasks: CUSTOM_LIST,
      });
    });

    /**
     * Navigation bugfix round 3: a shuffled "По номерам" single-number
     * session (V1-V5 of #13, reordered by resolveSingleNumberSession)
     * is exactly a customOrderedTasks list where every entry shares one
     * taskNumber. Next/previous must follow the FIXED shuffled order
     * given — never re-shuffle, never step by taskNumber (impossible
     * here anyway, since every entry has the same number 13), and never
     * call a random endpoint to find "the next task".
     */
    it('follows a shuffled same-number session (V1-V5 of #13) in the exact given order, never re-randomizing', () => {
      const SAME_NUMBER_SHUFFLED = [
        { taskId: 'v4-task-13', taskNumber: 13 },
        { taskId: 'v2-task-13', taskNumber: 13 },
        { taskId: 'v5-task-13', taskNumber: 13 },
        { taskId: 'v1-task-13', taskNumber: 13 },
        { taskId: 'v3-task-13', taskNumber: 13 },
      ];

      // V4 (first) → next is V2.
      const atV4 = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: 'v4-task-13',
            customOrderedTasks: SAME_NUMBER_SHUFFLED,
          }),
        { wrapper },
      );
      expect(atV4.result.current.previous).toBeNull();
      expect(atV4.result.current.next).toEqual(SAME_NUMBER_SHUFFLED[1]); // V2

      // V2 (second) → next is V5, previous is V4.
      const atV2 = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: 'v2-task-13',
            customOrderedTasks: SAME_NUMBER_SHUFFLED,
          }),
        { wrapper },
      );
      expect(atV2.result.current.previous).toEqual(SAME_NUMBER_SHUFFLED[0]); // V4
      expect(atV2.result.current.next).toEqual(SAME_NUMBER_SHUFFLED[2]); // V5

      // V5 (third) → next is V1, previous is V2.
      const atV5 = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: 'v5-task-13',
            customOrderedTasks: SAME_NUMBER_SHUFFLED,
          }),
        { wrapper },
      );
      expect(atV5.result.current.previous).toEqual(SAME_NUMBER_SHUFFLED[1]); // V2
      expect(atV5.result.current.next).toEqual(SAME_NUMBER_SHUFFLED[3]); // V1

      // V3 (last) → next is null, never wraps or invents a 6th task.
      const atV3 = renderHook(
        () =>
          useTaskNavigation({
            subjectId: 'math',
            taskId: 'v3-task-13',
            customOrderedTasks: SAME_NUMBER_SHUFFLED,
          }),
        { wrapper },
      );
      expect(atV3.result.current.next).toBeNull();

      // The whole list stays in the exact given shuffled order — never
      // re-sorted back to V1..V5, never re-randomized between renders.
      expect(atV4.result.current.orderedTasks).toEqual(SAME_NUMBER_SHUFFLED);
      expect(atV2.result.current.orderedTasks).toEqual(SAME_NUMBER_SHUFFLED);
    });
  });
});
