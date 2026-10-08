import { ApiError, getRandomTask, listTasksByNumber } from './api.js';
import type { Route } from './navigation.js';
import type { TaskPublic } from '@zybrilka/shared';

/**
 * The only way a `{ screen: 'task' }` route should ever be reached:
 * fetches a real published task from the API and navigates to its
 * actual UUID. `GET /api/v1/tasks/:id` requires a UUID, so navigating
 * straight to a design-mock id (e.g. the demo task's non-UUID id)
 * always fails with `400 invalid_id` and shows "Не удалось загрузить
 * задание."
 *
 * `collection` scopes the pick to that collection's tasks (via
 * `GET /tasks/random?collection=`) and is carried into the resulting
 * `task` route's `collectionSlug` so the selected source isn't lost
 * once the caller's own component unmounts — see navigation.tsx.
 */
/**
 * Subject → Варианты → "Собери собственный вариант": resolves every
 * picked task number to a real task (in parallel, `collection`
 * unrestricted means "Общий банк" — same single-task pick every other
 * unrestricted fetch in this app already uses) and navigates straight
 * into the first one carrying the *whole* resolved list as
 * `customOrderedTasks` (navigation.tsx) — this is what makes the
 * number strip show exactly the picked numbers and prev/next follow
 * them, instead of collapsing to just the first number with no
 * ordered context at all (Task Workspace block — the reported
 * "Варианты → Общие → сформировать вариант" bug).
 */
export function startCustomVariant(
  navigate: (route: Route) => void,
  params: {
    subject: string;
    taskNumbers: readonly number[];
    collection?: string;
    returnTo?: Route;
  },
): void {
  if (params.taskNumbers.length === 0) return;
  void Promise.all(
    params.taskNumbers.map((taskNumber) =>
      getRandomTask({ subject: params.subject, taskNumber, collection: params.collection }),
    ),
  ).then((tasks) => {
    const first = tasks[0]!;
    navigate({
      screen: 'task',
      subjectId: first.subjectId,
      taskNumber: first.taskNumber,
      taskId: first.id,
      collectionSlug: params.collection,
      customOrderedTasks: tasks.map((t) => ({ taskId: t.id, taskNumber: t.taskNumber })),
      returnTo: params.returnTo,
    });
  });
}

export function startRealTask(
  navigate: (route: Route) => void,
  params: {
    subject?: string;
    taskNumber?: number;
    collection?: string;
    topic?: string;
    /** Excludes tasks the user already has an attempt on — the same
     * real `unseen` filter every other entry point uses, never a
     * second mechanism. */
    unseen?: boolean;
    /** Where Task's back arrow should return to (audit Block 3) — see
     * `returnTo` on the `task` route in navigation.tsx. Absent means
     * "no known parent overlay", same as before this existed. */
    returnTo?: Route;
  } = {},
): void {
  void getRandomTask(params).then((task) => {
    navigate({
      screen: 'task',
      subjectId: task.subjectId,
      taskNumber: task.taskNumber,
      taskId: task.id,
      collectionSlug: params.collection,
      returnTo: params.returnTo,
    });
  });
}

/** Fisher-Yates — used wherever a selection of slots (task numbers,
 * identical-filter repeats) needs its *solving order* shuffled, never
 * which task gets picked for a slot (that stays exactly
 * `getRandomTask`/the real `unseen` filter). */
export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** One slot to resolve into a real task. `random` here means "ignore
 * the selected Сборник and draw from the whole published pool" (the
 * only real axis `getRandomTask` exposes beyond `unseen` — there is no
 * backend concept of a "non-random" pick, so OFF simply means "stay
 * scoped to the chosen source" rather than widen the pool). `unseen`
 * is the real backend `unseen` filter. The two are fully independent:
 * any of the four combinations is valid and maps onto a single real
 * `GET /tasks/random` call — no new backend mechanism. */
export interface TaskPickFilter {
  subject: string;
  topic?: string;
  taskNumber?: number;
  collection?: string;
  random: boolean;
  unseen: boolean;
}

export type TaskBatchError =
  | { reason: 'no_unseen_tasks'; index: number; filter: TaskPickFilter }
  | { reason: 'none'; index: number; filter: TaskPickFilter };

/**
 * Resolves a batch of independent `TaskPickFilter` slots into real
 * tasks — one at a time (never `Promise.all`), so a failure on one
 * slot stops immediately with an honest, specific error instead of
 * silently dropping it or substituting a random task for it, and
 * never discards tasks already resolved for earlier slots. A batch of
 * exactly one filter is the same code path as several — "По номерам"
 * (one filter per picked number), "По теме" with picked numbers (one
 * filter per number), and "По теме" with a fixed amount (the same
 * filter repeated N times, with a bounded de-dup retry since nothing
 * server-side excludes a task already drawn earlier in this same
 * batch) all go through this one function. Never resolves more than
 * `filters.length` tasks up front — "∞ Без ограничения" simply never
 * calls this with more than one filter (see `startRealTask`).
 */
export async function resolveTaskBatch(
  filters: readonly TaskPickFilter[],
  options: { shuffleOrder?: boolean } = {},
): Promise<{ tasks: TaskPublic[] } | { error: TaskBatchError }> {
  // "Перемешать порядок" reorders which slot is *solved* first — the
  // returned list (which becomes `customOrderedTasks`) stays in
  // exactly this order, shuffled or not.
  const order = options.shuffleOrder
    ? shuffled(filters.map((_, i) => i))
    : filters.map((_, i) => i);
  const tasks: TaskPublic[] = [];
  const usedIds = new Set<string>();

  for (const index of order) {
    const filter = filters[index]!;
    const query = {
      subject: filter.subject,
      topic: filter.topic,
      taskNumber: filter.taskNumber,
      collection: filter.random ? undefined : filter.collection,
      unseen: filter.unseen || undefined,
    };
    try {
      let task = await getRandomTask(query);
      // Nothing server-side excludes a task already drawn earlier in
      // this batch, so a handful of identical-filter slots (fixed
      // "Количество заданий" over the same topic/subject) can repeat —
      // a bounded local retry avoids that in the common case without
      // inventing a new backend exclusion mechanism. Exhausting the
      // retries just accepts the repeat rather than erroring.
      for (let attempt = 0; usedIds.has(task.id) && attempt < 4; attempt += 1) {
        task = await getRandomTask(query);
      }
      usedIds.add(task.id);
      tasks.push(task);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.body as { error?: string })?.error === 'no_unseen_tasks'
      ) {
        return { error: { reason: 'no_unseen_tasks', index, filter } };
      }
      return { error: { reason: 'none', index, filter } };
    }
  }

  return { tasks };
}

/**
 * "По номерам" with exactly ONE number selected (bugfix: correct task
 * navigation for a single selected number). `resolveTaskBatch` picks
 * one random task per DISTINCT number — for a single number that's a
 * list of length 1, which honestly (since `03864df`) shows "Задание 1
 * из 1" and nowhere to go next. That isn't this mode's real list: the
 * real list is every published copy of THIS ONE number across
 * variants/sources (today, one per Ященко V1-V5), the same "same-
 * number siblings" `listTasksByNumber` already exposes for TaskDesktop/
 * TaskMobile's "Другие задания" — reused here, not reinvented, as the
 * navigation list. Resolved once at session start; the returned ids
 * stay fixed (never re-rolled on Prev/Next).
 *
 * `random` ignores the selected Сборник, same meaning as everywhere
 * else `TaskPickFilter.random` is used. `unseen`, when on, additionally
 * calls the real `getRandomTask` unseen filter once to choose which of
 * these tasks to start on; if none of them is unseen, this fails the
 * same way `resolveTaskBatch` already does (`no_unseen_tasks`) rather
 * than silently starting on an already-solved one. `unseen` off simply
 * starts on the first entry (today, Вариант 1's copy) — no second
 * random pick.
 */
export async function resolveSingleNumberSession(
  filter: TaskPickFilter,
  options: { shuffleOrder?: boolean } = {},
): Promise<{ tasks: TaskPublic[]; startTaskId: string } | { error: TaskBatchError }> {
  const collection = filter.random ? undefined : filter.collection;
  const tasks = await listTasksByNumber(filter.subject, filter.taskNumber!, collection);
  if (tasks.length === 0) {
    return { error: { reason: 'none', index: 0, filter } };
  }

  let startTaskId = tasks[0]!.id;
  if (filter.unseen) {
    try {
      const picked = await getRandomTask({
        subject: filter.subject,
        taskNumber: filter.taskNumber,
        collection,
        unseen: true,
      });
      startTaskId = picked.id;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.body as { error?: string })?.error === 'no_unseen_tasks'
      ) {
        return { error: { reason: 'no_unseen_tasks', index: 0, filter } };
      }
      return { error: { reason: 'none', index: 0, filter } };
    }
  }

  const orderedTasks = options.shuffleOrder ? shuffled(tasks) : tasks;
  return { tasks: orderedTasks, startTaskId };
}
