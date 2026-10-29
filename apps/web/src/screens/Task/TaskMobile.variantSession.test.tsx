import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { TaskMobile } from './TaskMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import {
  LearningSessionProvider,
  useLearningSessionContext,
  type LearningSessionState,
} from '../../lib/learningSessionContext.js';
import * as api from '../../lib/api.js';
import { resetFavoritesCacheForTests } from '../../lib/useFavorite.js';
import { resetCanvasStoreForTests } from '../../lib/canvasSessionStore.js';
import { clearDraft, readDraft } from '../../lib/answerDrafts.js';

vi.mock('../../lib/api.js', () => ({
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(() => Promise.resolve([])),
  submitAttempt: vi.fn(),
  acknowledgeEssay: vi.fn(() => Promise.resolve({ acknowledged: true })),
  getVariant: vi.fn(),
  getVariantForTask: vi.fn(),
  getVariantAttempt: vi.fn(),
  openLearningSessionTask: vi.fn(),
  finishLearningSession: vi.fn(),
  listFavoriteTaskIds: vi.fn(() => Promise.resolve({ taskIds: [] })),
  addFavorite: vi.fn(() => Promise.resolve()),
  removeFavorite: vi.fn(() => Promise.resolve()),
  getLeaderboard: vi.fn(() => new Promise(() => {})),
  getStreak: vi.fn(() =>
    Promise.resolve({ currentStreak: 0, lastActiveDate: null, isActiveToday: false }),
  ),
}));

const SESSION = '99999999-9999-4999-8999-999999999999';
const VARIANT = '88888888-8888-4888-8888-888888888888';
const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `0000000${n}-0000-4000-8000-00000000000${n}`);

const task = (i: number) => ({
  id: ids[i]!,
  subjectId: 'math',
  taskNumber: i + 1,
  topicId: null,
  topicName: 'Тема',
  difficulty: 1 as const,
  conditionMd: `Условие задания ${i + 1}`,
  passage: null,
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerParts: null,
  answerOptions: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
});

const active = (i: number): LearningSessionState => ({
  status: 'active',
  sessionId: SESSION,
  subjectId: 'math',
  currentTaskId: ids[i]!,
  currentTaskNumber: i + 1,
  position: i + 1,
  total: ids.length,
  variant: { variantId: VARIANT, variantNumber: 3, variantTitle: 'Вариант 3' },
});

/** Seeds the session, then renders whatever task the router shows. */
function Harness({ start }: { start: number }) {
  const { setSession, session } = useLearningSessionContext();
  const { overlay, navigate, tab } = useNavigation();
  useEffect(() => {
    setSession(active(start));
    navigate({
      screen: 'task',
      subjectId: 'math',
      taskNumber: start + 1,
      taskId: ids[start]!,
      returnTo: { screen: 'learningSession', sessionId: SESSION },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <p data-testid="where">
        {overlay
          ? `${overlay.screen}${overlay.screen === 'task' ? `:${overlay.taskId}` : ''}`
          : tab}
      </p>
      <p data-testid="session">{session ? session.status : 'none'}</p>
      {overlay?.screen === 'task' && (
        <TaskMobile
          key={overlay.taskId}
          subjectId={overlay.subjectId}
          taskNumber={overlay.taskNumber}
          taskId={overlay.taskId}
          returnTo={overlay.returnTo}
        />
      )}
    </>
  );
}

function renderAt(start = 0) {
  return render(
    <NavigationProvider>
      <LearningSessionProvider>
        <Harness start={start} />
      </LearningSessionProvider>
    </NavigationProvider>,
  );
}

const strip = () =>
  screen.getByRole('button', { name: 'Предыдущие номера заданий' }).parentElement!;

describe('TaskMobile inside a variant attempt', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    ids.forEach(clearDraft);
    vi.mocked(api.getTask).mockImplementation((id) =>
      Promise.resolve(task(ids.indexOf(id as string))),
    );
    vi.mocked(api.getVariant).mockResolvedValue({
      variant: { id: VARIANT, collectionId: 'c', variantNumber: 3, title: 'Вариант 3', year: null },
      collection: {
        id: 'c',
        subjectId: 'math',
        slug: 'col',
        title: 'Сборник',
        publisher: null,
        year: null,
        description: null,
      },
      tasks: ids.map((_, i) => ({ position: i + 1, task: task(i) })),
    } as never);
    vi.mocked(api.getVariantAttempt).mockResolvedValue({
      tasks: ids.map((id, i) => ({
        taskId: id,
        outcome: i === 0 ? 'correct' : i === 1 ? 'incorrect' : i === 2 ? 'skipped' : 'not_reached',
      })),
    } as never);
    vi.mocked(api.openLearningSessionTask).mockImplementation((_s, taskId) => {
      const i = ids.indexOf(taskId);
      return Promise.resolve({
        sessionId: SESSION,
        subject: 'math',
        status: 'active',
        position: i + 1,
        total: ids.length,
        task: task(i),
        variant: { variantId: VARIANT, variantNumber: 3, variantTitle: 'Вариант 3' },
      } as never);
    });
  });

  it('shows the variant number panel with the real state of each task', async () => {
    renderAt(3);
    await screen.findByText('Условие задания 4');
    const panel = strip();
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Задание 1 — верно' })).toBeTruthy(),
    );
    expect(within(panel).getByRole('button', { name: 'Задание 2 — неверно' })).toBeTruthy();
    expect(
      within(panel).getByRole('button', { name: 'Задание 3 — открыто, без ответа' }),
    ).toBeTruthy();
    // Never opened: no state at all — opening is not solving.
    expect(within(panel).getByRole('button', { name: '7' })).toBeTruthy();
  });

  it('opens numbers in any order through the session (1 → 7 → 3 → 1), never answering anything', async () => {
    const user = userEvent.setup();
    renderAt(0);
    await screen.findByText('Условие задания 1');
    for (const n of [7, 3, 1]) {
      await user.click(
        within(strip()).getByRole('button', { name: new RegExp(`^(Задание )?${n}( |$)`) }),
      );
      await screen.findByText(`Условие задания ${n}`);
      expect(screen.getByTestId('where')).toHaveTextContent(`task:${ids[n - 1]}`);
    }
    expect(vi.mocked(api.openLearningSessionTask).mock.calls.map((c) => c[1])).toEqual([
      ids[6],
      ids[2],
      ids[0],
    ]);
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });

  it('keeps a typed but unchecked answer when switching away and back', async () => {
    const user = userEvent.setup();
    renderAt(4);
    const input = await screen.findByLabelText('Ответ');
    await user.click(input);
    await user.paste('42');
    await user.click(within(strip()).getByRole('button', { name: /^6$/ }));
    await screen.findByText('Условие задания 6');
    expect(readDraft(ids[4]!)).toBe('42');
    // The panel says task 5 has an unchecked answer.
    expect(
      within(strip()).getByRole('button', { name: 'Задание 5 — есть ответ, не проверен' }),
    ).toBeTruthy();
    await user.click(within(strip()).getByRole('button', { name: /Задание 5/ }));
    await screen.findByText('Условие задания 5');
    await waitFor(() => expect(screen.getByLabelText('Ответ')).toHaveValue('42'));
  });

  it('the back arrow no longer loops into the task: it asks, then leaves to Training with the session kept on the server', async () => {
    const user = userEvent.setup();
    renderAt(2);
    await screen.findByText('Условие задания 3');
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    const sheet = await screen.findByRole('dialog', { name: 'Выйти из варианта?' });
    await user.click(within(sheet).getByRole('button', { name: 'Остаться' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`task:${ids[2]}`);

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Выйти из варианта?' })).getByRole(
        'button',
        { name: 'Выйти' },
      ),
    );
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('training'));
    expect(screen.getByTestId('session')).toHaveTextContent('none');
    expect(api.finishLearningSession).not.toHaveBeenCalled();
  });

  it('«Завершить вариант» finishes it and lands on the result', async () => {
    const user = userEvent.setup();
    vi.mocked(api.finishLearningSession).mockResolvedValue({
      sessionId: SESSION,
      subject: 'math',
      status: 'completed',
      position: 3,
      total: ids.length,
      summary: {
        attempted: 2,
        correct: 1,
        incorrect: 1,
        accuracy: 50,
        skillsPracticed: 0,
        mistakesCreated: 0,
      },
      variant: { variantId: VARIANT, variantNumber: 3, variantTitle: 'Вариант 3' },
    } as never);
    renderAt(2);
    await screen.findByText('Условие задания 3');
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Выйти из варианта?' })).getByRole(
        'button',
        { name: /Завершить вариант/ },
      ),
    );
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('learningSession'));
    expect(screen.getByTestId('session')).toHaveTextContent('completed');
    expect(api.finishLearningSession).toHaveBeenCalledWith(SESSION);
  });
});
