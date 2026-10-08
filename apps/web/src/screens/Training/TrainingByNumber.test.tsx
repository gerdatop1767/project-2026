import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrainingByNumber } from './TrainingByNumber.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => {
  class MockApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API request failed with status ${status}`);
    }
  }
  return {
    listCollections: vi.fn(),
    getRandomTask: vi.fn(),
    listTasksByNumber: vi.fn(),
    ApiError: MockApiError,
  };
});

const COLLECTION = {
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
    return <p data-testid="overlay">task:{overlay.taskNumber}</p>;
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderScreen(props: Partial<React.ComponentProps<typeof TrainingByNumber>> = {}) {
  return render(
    <NavigationProvider>
      <TrainingByNumber {...props} />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.listCollections).mockResolvedValue([]);
  // Single-number "По номерам" default: a non-empty same-number list so
  // every test that doesn't care about its exact contents still
  // resolves — see resolveSingleNumberSession.
  vi.mocked(api.listTasksByNumber).mockResolvedValue([RANDOM_TASK]);
});

describe('TrainingByNumber', () => {
  it('requires at least one number before starting', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText('Выбери хотя бы один номер задания.')).toBeInTheDocument();
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('a newly selected number defaults to both flags off — "обычный выбор"', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    // Exactly one number selected: the real navigation list comes from
    // listTasksByNumber (every variant's copy of #5), never a single
    // random pick — see resolveSingleNumberSession (navigation bugfix).
    await waitFor(() => {
      expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 5, undefined, false);
    });
    expect(api.getRandomTask).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));
  });

  it('🎲 and 🔄 are independent — both can be on for the same number at once', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    renderScreen();

    const trigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));

    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Случайное' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    expect(screen.getByRole('button', { name: 'Случайное' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Только нерешённые' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      // 🎲 ON drops the Сборник scope (draws from the whole bank); 🔄 ON
      // excludes correctly-solved tasks server-side — both apply to the
      // SAME listTasksByNumber call, at once, never exclusive, and
      // never a second getRandomTask call.
      expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 5, undefined, true);
    });
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('🎲 OFF + 🔄 ON stays scoped to the selected Сборник with the unseen filter', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    renderScreen();

    const trigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));

    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.listTasksByNumber).toHaveBeenCalledWith(
        'math',
        5,
        COLLECTION.collection.slug,
        true,
      );
    });
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('🎲 ON + 🔄 OFF drops the collection scope without the unseen filter', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    renderScreen();

    const trigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));

    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Случайное' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 5, undefined, false);
    });
    // No "unseen" refinement requested — the starting task is just the
    // first entry in the list, no getRandomTask call needed.
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('mixes independent flag combinations across different numbers in one run', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockImplementation((params) =>
      Promise.resolve({
        ...RANDOM_TASK,
        id: `task-${params.taskNumber}`,
        taskNumber: params.taskNumber!,
      }),
    );
    renderScreen();
    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: '№7' }));
    const unseenToggles = screen.getAllByRole('button', { name: 'Только нерешённые' });
    // №5 stays off/off (default); mark №7 (the second row) unseen.
    await user.click(unseenToggles[1]!);
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => expect(api.getRandomTask).toHaveBeenCalledTimes(2));
    expect(api.getRandomTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ taskNumber: 5, unseen: undefined }),
    );
    expect(api.getRandomTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taskNumber: 7, unseen: true }),
    );
  });

  it('"Перемешать порядок" reorders which selected number is solved first', async () => {
    const user = userEvent.setup();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // always swap to front
    vi.mocked(api.getRandomTask).mockImplementation((params) =>
      Promise.resolve({
        ...RANDOM_TASK,
        id: `task-${params.taskNumber}`,
        taskNumber: params.taskNumber!,
      }),
    );
    renderScreen();
    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: '№7' }));
    await user.click(screen.getByRole('button', { name: 'Перемешать порядок' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => expect(api.getRandomTask).toHaveBeenCalledTimes(2));
    // With Math.random mocked to 0, Fisher-Yates always swaps the last
    // element to the front — the sorted [5, 7] becomes [7, 5].
    expect(api.getRandomTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ taskNumber: 7 }),
    );
    randomSpy.mockRestore();
  });

  it('shows the specific "no unseen tasks" message for that number, never silently substituting a random (already-solved) task', async () => {
    const user = userEvent.setup();
    // Every copy of #5 already has a correct attempt — the server-side
    // `unsolved` filter leaves nothing, not a fallback to a random pick.
    vi.mocked(api.listTasksByNumber).mockResolvedValue([]);
    renderScreen();
    await user.click(screen.getByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(
      await screen.findByText(
        'Для №5 больше нет нерешённых заданий. Можно выключить «Только нерешённые» для этого номера.',
      ),
    ).toBeInTheDocument();
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('works for an arbitrary subject/taskNumber combination — never hardcoded to one number', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTasksByNumber).mockResolvedValue([{ ...RANDOM_TASK, taskNumber: 12 }]);
    renderScreen();
    await user.click(screen.getByRole('button', { name: '№12' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 12, undefined, false);
    });
  });

  it("seeds the subject/collection from props (e.g. arriving from Subject's own tab)", async () => {
    vi.mocked(api.listCollections).mockResolvedValue([
      { ...COLLECTION, collection: { ...COLLECTION.collection, subjectId: 'russian' } },
    ]);
    renderScreen({ subjectId: 'russian' });
    expect(await screen.findByRole('button', { name: /Русский язык/ })).toBeInTheDocument();
  });

  it('BackRow returns to the real `from` route instead of a hardcoded Training', async () => {
    const user = userEvent.setup();
    renderScreen({ from: { screen: 'subject', subjectId: 'math', initialMode: 'topics' } });
    expect(screen.getByRole('button', { name: 'Математика' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Математика' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });
});

/**
 * Navigation bugfix: selecting exactly ONE number builds a real
 * multi-variant navigation list (every published copy of that number),
 * never a single-item "Задание 1 из 1" list — see
 * resolveSingleNumberSession's doc comment. Exercises the exact
 * real-data scenario from the bug report: #13 across 5 Ященко variants.
 */
describe('TrainingByNumber — single-number session (navigation bugfix)', () => {
  function variantTask(variant: number, taskNumber: number) {
    return { ...RANDOM_TASK, id: `v${variant}-task-${taskNumber}`, taskNumber };
  }

  function FullOverlayMarker() {
    const { overlay } = useNavigation();
    if (overlay?.screen !== 'task') return <p data-testid="full-overlay">{overlay?.screen}</p>;
    return (
      <p data-testid="full-overlay">
        taskId:{overlay.taskId}|taskNumber:{overlay.taskNumber}|session:
        {(overlay.customOrderedTasks ?? []).map((t) => t.taskId).join(',')}
      </p>
    );
  }

  function renderWithFullOverlay(
    props: Partial<React.ComponentProps<typeof TrainingByNumber>> = {},
  ) {
    return render(
      <NavigationProvider>
        <TrainingByNumber {...props} />
        <FullOverlayMarker />
      </NavigationProvider>,
    );
  }

  it("Test 1: builds a 5-entry session, all sharing taskNumber 13, from every variant's copy", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    renderWithFullOverlay();
    await user.click(screen.getByRole('button', { name: '№13' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(screen.getByTestId('full-overlay')).toHaveTextContent(
        'session:v1-task-13,v2-task-13,v3-task-13,v4-task-13,v5-task-13',
      ),
    );
    expect(screen.getByTestId('full-overlay')).toHaveTextContent('taskId:v1-task-13');
    expect(screen.getByTestId('full-overlay')).toHaveTextContent('taskNumber:13');
  });

  it('Test 2-4: prev/next step through V1#13 → V2#13 → ... → V5#13, never #14', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      variantTask(1, 13),
      variantTask(2, 13),
      variantTask(3, 13),
      variantTask(4, 13),
      variantTask(5, 13),
    ]);
    renderWithFullOverlay();
    await user.click(screen.getByRole('button', { name: '№13' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(screen.getByTestId('full-overlay')).toHaveTextContent('v1-task-13'));
    // The landed task is V1#13 — first entry, previous disabled, next is V2#13.
    expect(screen.getByTestId('full-overlay')).toHaveTextContent('taskId:v1-task-13');
  });

  it('a single-entry list (no other variant has this number) falls back to "1 of 1" honestly, never fabricating siblings', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTasksByNumber).mockResolvedValue([variantTask(1, 17)]);
    renderWithFullOverlay();
    await user.click(screen.getByRole('button', { name: '№17' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(screen.getByTestId('full-overlay')).toHaveTextContent('session:v1-task-17'),
    );
  });
});

/**
 * `initialTaskNumber` (UX bugfix round 3 — "Другие задания" → "К
 * списку заданий №N"): pre-selects exactly that number on entry, both
 * flags off (same shape a manual chip click gives), the user can
 * freely add/remove numbers afterward, and training is NEVER
 * auto-started — the user still has to press "Начать тренировку"
 * themselves.
 */
describe('TrainingByNumber — initialTaskNumber (pre-selects on entry, never auto-starts)', () => {
  it('Test 7: №13 is already selected on entry', () => {
    renderScreen({ initialTaskNumber: 13 });
    expect(screen.getByRole('button', { name: '№13' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Test 8: no other number is pre-selected', () => {
    renderScreen({ initialTaskNumber: 13 });
    expect(screen.getByRole('button', { name: '№5' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '№7' })).toHaveAttribute('aria-pressed', 'false');
    // Only one mode row exists (for №13) — confirms nothing else got selected.
    expect(screen.getAllByText(/^№\d+$/, { selector: 'span' })).toHaveLength(1);
  });

  it('Test 9: the user can still add another number on top of the pre-selected one', async () => {
    const user = userEvent.setup();
    renderScreen({ initialTaskNumber: 13 });
    await user.click(screen.getByRole('button', { name: '№5' }));
    expect(screen.getByRole('button', { name: '№13' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '№5' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Test 9b: the user can remove the pre-selected number just like any other chip', async () => {
    const user = userEvent.setup();
    renderScreen({ initialTaskNumber: 13 });
    await user.click(screen.getByRole('button', { name: '№13' }));
    expect(screen.getByRole('button', { name: '№13' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Test 10: training never starts automatically — "Начать тренировку" still requires an explicit click', () => {
    renderScreen({ initialTaskNumber: 13 });
    expect(api.getRandomTask).not.toHaveBeenCalled();
    expect(api.listTasksByNumber).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Начать тренировку' })).toBeInTheDocument();
  });

  it('pressing "Начать тренировку" after entering with initialTaskNumber works exactly like a manual pick', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTasksByNumber).mockResolvedValue([{ ...RANDOM_TASK, taskNumber: 13 }]);
    renderScreen({ initialTaskNumber: 13 });
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.listTasksByNumber).toHaveBeenCalledWith('math', 13, undefined, false);
    });
  });

  it('Test 11: a normal entry with no initialTaskNumber is completely unchanged — nothing pre-selected', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: '№13' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Режим для каждого номера')).not.toBeInTheDocument();
  });

  it('Test 12: an out-of-range initialTaskNumber (math only has 19) is safely ignored, never a crash', () => {
    renderScreen({ initialTaskNumber: 999 });
    expect(screen.queryByText('Режим для каждого номера')).not.toBeInTheDocument();
    // The screen still renders normally — the chip grid and button are present.
    expect(screen.getByRole('button', { name: '№1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать тренировку' })).toBeInTheDocument();
  });

  it('a zero/negative initialTaskNumber is also safely ignored', () => {
    renderScreen({ initialTaskNumber: 0 });
    expect(screen.queryByText('Режим для каждого номера')).not.toBeInTheDocument();
  });
});
