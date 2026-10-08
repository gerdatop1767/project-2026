import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectDesktop } from './SubjectDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getRandomTask: vi.fn(),
  listCollections: vi.fn(),
  getProgressByTopic: vi.fn(),
  getProgressSummary: vi.fn(),
  getTaskCountsBySubject: vi.fn(),
}));

// Every render starts on the 'topics' mode, so its effect always fires
// regardless of which mode a given test actually exercises — a neutral
// default keeps unrelated tests from needing to know about topics.
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

function OverlayMarker() {
  const { overlay, tab } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? `tab:${tab}`}</p>;
}

function renderSubject() {
  return render(
    <NavigationProvider>
      <SubjectDesktop subjectId="math" from="subjectCatalog" />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('SubjectDesktop — hero icon and glow', () => {
  it('renders the real subject illustration instead of the old glyph tile', () => {
    mockCollections();
    renderSubject();
    const img = document.querySelector('img[src="/branding/v2/subjects/math.png"]');
    expect(img).toBeInTheDocument();
    // No leftover SubjectTile glyph (rendered as an inline SVG/lucide
    // icon) inside the hero — the image itself carries the artwork now.
    expect(img!.parentElement!.querySelector('svg')).not.toBeInTheDocument();
  });
});

describe('SubjectDesktop — honest loading state (mobile page flash regression)', () => {
  // Same bug/fix as SubjectMobile.test.tsx: `solved`/`accuracyPercent`
  // used to initialize to `0`, rendering a fake "0 решено / 0% точность"
  // indistinguishable from a real zero while `getProgressSummary` was
  // still in flight. Must show an honest '···' placeholder instead.
  it('never shows a fake "0 решено / 0% точность" while the real progress is still loading', async () => {
    mockCollections();
    let resolveProgress!: (value: Awaited<ReturnType<typeof api.getProgressSummary>>) => void;
    vi.mocked(api.getProgressSummary).mockReturnValue(
      new Promise((resolve) => {
        resolveProgress = resolve;
      }),
    );
    renderSubject();

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
});

describe('SubjectDesktop — Темы (real API, no fake hash)', () => {
  function mockTopics(
    items: { topicId: string; topicName: string; total: number; completed: number }[],
  ) {
    vi.mocked(api.getProgressByTopic).mockResolvedValue({ items });
  }

  it('shows real topics with real X/Y, not the static design-content list', async () => {
    mockCollections();
    mockTopics([{ topicId: 't1', topicName: 'Логарифмы', total: 4, completed: 1 }]);
    renderSubject();
    await waitFor(() => expect(screen.getByText('Логарифмы')).toBeInTheDocument());
    expect(screen.getByText('1 / 4 решено')).toBeInTheDocument();
  });

  it('an empty topic list (e.g. unknown source) shows a neutral empty state, not a fake row', async () => {
    mockCollections();
    mockTopics([]);
    renderSubject();
    await waitFor(() =>
      expect(screen.getByText('В этом источнике пока нет тем.')).toBeInTheDocument(),
    );
  });

  it('switching the topics source selector refetches scoped by the new collection', async () => {
    mockCollections();
    vi.mocked(api.getProgressByTopic).mockImplementation(({ collection }) =>
      Promise.resolve({
        items: collection
          ? [{ topicId: 't-yash', topicName: 'Планиметрия', total: 1, completed: 0 }]
          : [{ topicId: 't-agg', topicName: 'Логарифмы', total: 4, completed: 1 }],
      }),
    );
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => expect(screen.getByText('Логарифмы')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Общий банк' })[0]!);
    await user.click(screen.getByRole('option', { name: 'ЕГЭ 2026 Ященко' }));

    await waitFor(() => expect(screen.getByText('Планиметрия')).toBeInTheDocument());
    expect(api.getProgressByTopic).toHaveBeenLastCalledWith({
      subject: 'math',
      collection: 'ege-2026-yashchenko',
    });
  });

  it('drilling into a topic and starting training passes its real topicId to getRandomTask', async () => {
    mockCollections();
    mockTopics([{ topicId: 'real-topic-id', topicName: 'Логарифмы', total: 4, completed: 1 }]);
    vi.mocked(api.getRandomTask).mockResolvedValue({
      id: 'task-1',
      subjectId: 'math',
      taskNumber: 9,
      topicId: 'real-topic-id',
      topicName: 'Логарифмы',
      difficulty: 2,
      conditionMd: 'Условие',
      imageUrl: null,
      hintMd: null,
      answerType: 'short_answer',
      answerOptions: null,
      source: 'Ященко',
      sourceUrl: null,
      sourceYear: 2026,
      tags: [],
      status: 'published',
    } as never);
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => screen.getByText('Логарифмы'));
    await user.click(screen.getByText('Логарифмы'));
    await user.click(screen.getByRole('button', { name: /Начать тренировку/ }));
    await waitFor(() => {
      expect(api.getRandomTask).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'math', topic: 'real-topic-id' }),
      );
    });
  });

  it('a topic with total=0 disables the start button rather than dividing by zero', async () => {
    mockCollections();
    mockTopics([{ topicId: 't1', topicName: 'Пустая тема', total: 0, completed: 0 }]);
    const user = userEvent.setup();
    renderSubject();
    await waitFor(() => screen.getByText('Пустая тема'));
    await user.click(screen.getByText('Пустая тема'));
    expect(screen.getByRole('button', { name: /Начать тренировку/ })).toBeDisabled();
  });
});

describe('SubjectDesktop — "Случайные задания" mode removed (now lives in Training)', () => {
  it('no longer shows a "Случайные задания" mode tab', () => {
    mockCollections();
    renderSubject();
    expect(screen.queryByText('Случайные задания')).not.toBeInTheDocument();
  });

  it('only shows the remaining three mode tabs, so the grid is not empty/broken', () => {
    mockCollections();
    renderSubject();
    expect(screen.getByText('Темы')).toBeInTheDocument();
    expect(screen.getByText('Варианты')).toBeInTheDocument();
    expect(screen.getByText('Избранное')).toBeInTheDocument();
  });

  it('"Быстрый старт" → "Случайное задание" now navigates to Training instead of a removed mode', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Случайное задание'));
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('training'));
  });
});

describe('SubjectDesktop — Варианты (real collections, source isolation)', () => {
  it('lets picking individual task numbers and a real collection source, updating the summary', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Полные варианты ЕГЭ'));
    expect(
      screen.getByText('Собери собственный вариант из нужных заданий и источников'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Выбрано 2 заданий')).toBeInTheDocument();
    expect(screen.getByText(/Номера: 1, 2/)).toBeInTheDocument();
    expect(screen.getByText(/Источник: Общий банк/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Общий банк' }));
    await user.click(screen.getByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    expect(screen.getByText(/Источник: ЕГЭ 2026 Ященко/)).toBeInTheDocument();
  });

  describe('source isolation', () => {
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
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByText('Полные варианты ЕГЭ'));
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      expect(screen.getAllByRole('option', { name: 'ЕГЭ 2026 Ященко' })).toHaveLength(1);
      expect(screen.getAllByRole('option', { name: 'ФИПИ 2026' })).toHaveLength(1);
    });

    it('does not show Ященко nested under the ФИПИ option or vice versa', async () => {
      mockCollections([YASHCHENKO_COLLECTION, FIPI_COLLECTION]);
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByText('Полные варианты ЕГЭ'));
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      const fipiOption = screen.getByRole('option', { name: 'ФИПИ 2026' });
      expect(fipiOption.textContent).not.toContain('Ященко');
      const yashchenkoOption = screen.getByRole('option', { name: 'ЕГЭ 2026 Ященко' });
      expect(yashchenkoOption.textContent).not.toContain('ФИПИ');
    });

    it('"Общий банк" stays the single aggregate option, not a real collection', async () => {
      mockCollections([YASHCHENKO_COLLECTION, FIPI_COLLECTION]);
      const user = userEvent.setup();
      renderSubject();
      await user.click(screen.getByText('Полные варианты ЕГЭ'));
      expect(screen.getByText(/Источник: Общий банк/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Общий банк' }));
      expect(screen.getAllByRole('option').length).toBe(3); // Общий банк + Ященко + ФИПИ
    });
  });

  it('"Выбрать всё" selects every task number', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Полные варианты ЕГЭ'));
    await user.click(screen.getByRole('button', { name: /Выбрать всё/ }));
    expect(screen.getByText('Выбрано 19 заданий')).toBeInTheDocument();
  });

  it('reset clears the selection', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Полные варианты ЕГЭ'));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: /Сбросить/ }));
    expect(screen.getByText('Выбрано 0 заданий')).toBeInTheDocument();
    expect(screen.getByText(/Номера не выбраны/)).toBeInTheDocument();
  });

  it('disables the primary CTA until at least one number is selected', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Полные варианты ЕГЭ'));
    expect(screen.getByRole('button', { name: /Собрать вариант/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByRole('button', { name: /Собрать вариант/ })).toBeEnabled();
  });

  it('resolves every picked number (not just the first) into a real customOrderedTasks list — the "Варианты → Общие → сформировать вариант" bug', async () => {
    mockCollections();
    vi.mocked(api.getRandomTask).mockImplementation(({ taskNumber }) =>
      Promise.resolve({
        id: `task-${taskNumber}`,
        subjectId: 'math',
        taskNumber: taskNumber!,
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
      }),
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
        <SubjectDesktop subjectId="math" from="subjectCatalog" />
        <TaskOverlayProbe />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('Полные варианты ЕГЭ'));
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

describe('SubjectDesktop — Задания по номерам tab (audit: the tab that went missing)', () => {
  it('shows a separate "Задания по номерам" tab alongside Темы/Варианты/Избранное', () => {
    mockCollections();
    renderSubject();
    expect(screen.getByText('Задания по номерам')).toBeInTheDocument();
    expect(screen.getByText('Выбрать конкретное задание')).toBeInTheDocument();
  });

  it('navigates to the dedicated TrainingByNumber screen, carrying subject/collection/from — not an inline block', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByText('Задания по номерам'));
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent('trainingByNumber'),
    );
  });
});

describe('SubjectDesktop — BackRow', () => {
  it('returns to the parent screen it opened from (subjectCatalog), not the tab underneath', async () => {
    mockCollections();
    const user = userEvent.setup();
    renderSubject();
    await user.click(screen.getByRole('button', { name: 'К предметам' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subjectCatalog');
  });
});
