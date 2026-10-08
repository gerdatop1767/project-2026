import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectMobile } from './SubjectMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { getSubjectContent } from '../../data/subjectContent.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getRandomTask: vi.fn(),
  listCollections: vi.fn(),
  getProgressByTaskNumber: vi.fn(),
  getProgressByTopic: vi.fn(),
  getProgressSummary: vi.fn(),
  getTaskCountsBySubject: vi.fn(),
}));

// Every render starts on the 'topics' mode, so its effect always fires —
// a neutral default keeps unrelated tests from needing to know about it.
beforeEach(() => {
  vi.mocked(api.getProgressByTopic).mockResolvedValue({ items: [] });
  vi.mocked(api.getProgressSummary).mockResolvedValue({
    solvedTotal: 0,
    correctTotal: 0,
    incorrectTotal: 0,
    accuracyPercent: 0,
    bySubject: [],
    byTaskNumber: [],
    byTopic: [],
    timeBySubject: [],
  });
  vi.mocked(api.getTaskCountsBySubject).mockResolvedValue({ items: [] });
});

const YASHCHENKO_COLLECTION = {
  collection: {
    id: 'c1',
    subjectId: 'math',
    slug: 'ege-2026-yashchenko',
    title: 'ЕГЭ 2026 Ященко',
    publisher: 'Ященко',
    year: 2026,
    description: null,
  },
  variants: [{ id: 'v1', collectionId: 'c1', variantNumber: 1, title: 'Вариант 1', year: 2026 }],
};

function mockCollections(items = [YASHCHENKO_COLLECTION]) {
  vi.mocked(api.listCollections).mockResolvedValue(items);
}

function aggregateProgress() {
  return {
    items: Array.from({ length: 19 }, (_, i) => ({
      subjectId: 'math',
      taskNumber: i + 1,
      total: 3,
      completed: 0,
      correct: 0,
      incorrect: 0,
      accuracyPercent: null,
    })),
  };
}

function mockProgress(res = aggregateProgress()) {
  vi.mocked(api.getProgressByTaskNumber).mockResolvedValue(res);
}

const RANDOM_TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 5,
  topicId: null,
  topicName: null,
  difficulty: 2 as const,
  conditionMd: 'Условие',
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerOptions: null,
  answerParts: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'task') {
    const returnTo = overlay.returnTo;
    return (
      <p data-testid="overlay">
        task:returnTo=
        {returnTo?.screen === 'subject' ? `subject:${returnTo.initialMode ?? 'no-mode'}` : 'none'}
      </p>
    );
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderSubject(subjectId = 'math') {
  return render(
    <NavigationProvider>
      <SubjectMobile subjectId={subjectId} from="subjectCatalog" />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('SubjectMobile', () => {
  it('renders the hero and real topics (not the static design-content list)', async () => {
    mockCollections();
    mockProgress();
    vi.mocked(api.getProgressByTopic).mockResolvedValue({
      items: [{ topicId: 't1', topicName: 'Логарифмы', total: 4, completed: 1 }],
    });
    renderSubject();
    const content = getSubjectContent('math');
    expect(screen.getAllByText('Математика').length).toBeGreaterThan(0);
    expect(screen.getByText(content.tagline)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Логарифмы')).toBeInTheDocument());
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  // Regression test for the mobile page flash: before this fix, `solved`/
  // `accuracyPercent` initialized to `0`, so the hero/progress-ring
  // briefly rendered a fake "0 решено / 0% точность" (indistinguishable
  // from a real zero) during this screen's entrance animation, before
  // `getProgressSummary` resolved — confirmed via frame-by-frame video of
  // exactly this screen opening. Real behavior must show an honest
  // loading placeholder ('···'), never a fabricated zero.
  it('never shows a fake "0 решено / 0% точность" while the real progress is still loading', async () => {
    mockCollections();
    let resolveProgress!: (value: Awaited<ReturnType<typeof api.getProgressSummary>>) => void;
    vi.mocked(api.getProgressSummary).mockReturnValue(
      new Promise((resolve) => {
        resolveProgress = resolve;
      }),
    );
    renderSubject();

    // While the request is still in flight: honest placeholders, never 0.
    expect(screen.getAllByText('···').length).toBeGreaterThan(0);
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();

    resolveProgress({
      solvedTotal: 12,
      correctTotal: 9,
      incorrectTotal: 3,
      accuracyPercent: 0,
      bySubject: [
        { subjectId: 'math', solved: 12, correct: 9, accuracyPercent: 75, uniqueSolved: 12 },
      ],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });

    await waitFor(() => expect(screen.getAllByText('12').length).toBeGreaterThan(0));
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
  });

  it('an empty topic list shows a neutral empty state, not a fake row', async () => {
    mockCollections();
    mockProgress();
    renderSubject();
    await waitFor(() =>
      expect(screen.getByText('В этом источнике пока нет тем.')).toBeInTheDocument(),
    );
  });

  it('switches to Варианты and shows the real collections in the source picker + number chips', async () => {
    mockCollections();
    mockProgress();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByRole('button', { name: 'Варианты' }));
    expect(screen.getByText('Общий банк')).toBeInTheDocument();
    expect(screen.getByText('Выбрать всё')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Общий банк' }));
    expect(screen.getByRole('option', { name: 'ЕГЭ 2026 Ященко' })).toBeInTheDocument();
  });

  describe('Варианты — source isolation', () => {
    const FIPI_COLLECTION = {
      collection: {
        id: 'c2',
        subjectId: 'math',
        slug: 'fipi-2026',
        title: 'ФИПИ 2026',
        publisher: 'ФИПИ',
        year: 2026,
        description: null,
      },
      variants: [
        { id: 'v2', collectionId: 'c2', variantNumber: 1, title: 'Вариант 1', year: 2026 },
      ],
    };

    it('lists Ященко and ФИПИ as two separate, non-duplicated source options', async () => {
      mockCollections([YASHCHENKO_COLLECTION, FIPI_COLLECTION]);
      mockProgress();
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByRole('button', { name: 'Варианты' }));
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      expect(screen.getAllByRole('option', { name: 'ЕГЭ 2026 Ященко' })).toHaveLength(1);
      expect(screen.getAllByRole('option', { name: 'ФИПИ 2026' })).toHaveLength(1);
    });

    it('does not show Ященко nested under the ФИПИ option or vice versa', async () => {
      mockCollections([YASHCHENKO_COLLECTION, FIPI_COLLECTION]);
      mockProgress();
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByRole('button', { name: 'Варианты' }));
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      const fipiOption = screen.getByRole('option', { name: 'ФИПИ 2026' });
      expect(fipiOption.textContent).not.toContain('Ященко');
      const yashchenkoOption = screen.getByRole('option', { name: 'ЕГЭ 2026 Ященко' });
      expect(yashchenkoOption.textContent).not.toContain('ФИПИ');
    });

    it('"Общий банк" stays the single aggregate option, not a real collection', async () => {
      mockCollections([YASHCHENKO_COLLECTION, FIPI_COLLECTION]);
      mockProgress();
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByRole('button', { name: 'Варианты' }));
      expect(screen.getByText(/Источник: Общий банк/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      expect(screen.getAllByRole('option').length).toBe(3); // Общий банк + Ященко + ФИПИ
    });
  });

  it('drills into a real topic and back returns to the topics list without leaving the page', async () => {
    mockCollections();
    mockProgress();
    vi.mocked(api.getProgressByTopic).mockResolvedValue({
      items: [
        { topicId: 't1', topicName: 'Логарифмы', total: 4, completed: 1 },
        { topicId: 't2', topicName: 'Планиметрия', total: 2, completed: 0 },
      ],
    });
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => screen.getByText('Логарифмы'));
    await user.click(screen.getAllByText('Логарифмы')[0]!);
    expect(screen.getByRole('button', { name: /Начать тренировку/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getAllByText('Планиметрия').length).toBeGreaterThan(0);
  });

  it('starting a topic training session passes the real topicId and navigates to the task overlay', async () => {
    mockCollections();
    mockProgress();
    vi.mocked(api.getProgressByTopic).mockResolvedValue({
      items: [{ topicId: 'real-topic-id', topicName: 'Логарифмы', total: 4, completed: 1 }],
    });
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => screen.getByText('Логарифмы'));
    await user.click(screen.getAllByText('Логарифмы')[0]!);
    await user.click(screen.getByRole('button', { name: /Начать тренировку/ }));
    await waitFor(() => {
      expect(api.getRandomTask).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'math', topic: 'real-topic-id' }),
      );
      expect(screen.getByTestId('overlay')).toHaveTextContent('task');
    });
  });

  it('starting training passes a returnTo back to this subject page (audit Block 3)', async () => {
    mockCollections();
    mockProgress();
    vi.mocked(api.getProgressByTopic).mockResolvedValue({
      items: [{ topicId: 'real-topic-id', topicName: 'Логарифмы', total: 4, completed: 1 }],
    });
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => screen.getByText('Логарифмы'));
    await user.click(screen.getAllByText('Логарифмы')[0]!);
    await user.click(screen.getByRole('button', { name: /Начать тренировку/ }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('subject:topics');
    });
  });
});

describe('SubjectMobile — Задания по номерам tab (audit: the tab that went missing)', () => {
  it('shows a separate "По номерам" tab alongside Темы/Варианты/Избранное', () => {
    mockCollections();
    mockProgress();
    renderSubject();
    expect(screen.getByRole('button', { name: 'По номерам' })).toBeInTheDocument();
  });

  it('navigates to the dedicated TrainingByNumber screen, carrying subject/collection/from', async () => {
    mockCollections();
    mockProgress();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByRole('button', { name: 'По номерам' }));
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent('trainingByNumber'),
    );
  });
});

describe('SubjectMobile — VariantBuilder (Task Workspace block — "Варианты → Общие → сформировать вариант")', () => {
  it('resolves every picked number (not just the first) into a real customOrderedTasks list', async () => {
    mockCollections();
    mockProgress();
    vi.mocked(api.getRandomTask).mockImplementation(({ taskNumber }) =>
      Promise.resolve({ ...RANDOM_TASK, id: `task-${taskNumber}`, taskNumber: taskNumber! }),
    );
    function TaskOverlayProbe() {
      const { overlay } = useNavigation();
      if (overlay?.screen !== 'task') return <p data-testid="task-overlay">none</p>;
      return (
        <p data-testid="task-overlay">
          {JSON.stringify({
            taskId: overlay.taskId,
            customOrderedNumbers: overlay.customOrderedTasks?.map((t) => t.taskNumber) ?? null,
          })}
        </p>
      );
    }
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <SubjectMobile subjectId="math" from="subjectCatalog" />
        <TaskOverlayProbe />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('Варианты'));
    for (const n of [1, 3, 4, 7]) {
      await user.click(screen.getByRole('button', { name: String(n) }));
    }
    await user.click(screen.getByRole('button', { name: /Собрать вариант/ }));

    await waitFor(() => expect(screen.getByTestId('task-overlay')).not.toHaveTextContent('none'));
    const probeData = JSON.parse(screen.getByTestId('task-overlay').textContent!);
    expect(probeData.taskId).toBe('task-1');
    expect(probeData.customOrderedNumbers).toEqual([1, 3, 4, 7]);
    expect(vi.mocked(api.getRandomTask)).toHaveBeenCalledTimes(4);
  });
});
