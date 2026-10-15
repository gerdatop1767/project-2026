import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskPublic } from '@zybrilka/shared';
import { FavoritesList } from './FavoritesList.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  listFavoriteTaskIds: vi.fn(),
  getTask: vi.fn(),
  removeFavorite: vi.fn(),
}));

function task(overrides: Partial<TaskPublic> = {}): TaskPublic {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    subjectId: 'math',
    taskNumber: 5,
    topicId: null,
    topicName: 'Логарифмы',
    difficulty: 2,
    conditionMd: 'Решите уравнение log₂(x) = 3.',
    passage: null,
    imageUrl: null,
    hintMd: null,
    answerType: 'short_answer',
    answerOptions: null,
    answerParts: null,
    source: 'ФИПИ',
    sourceUrl: null,
    sourceYear: 2026,
    tags: [],
    status: 'published',
    ...overrides,
  };
}

const MATH_TASK = task();
const OTHER_SUBJECT_TASK = task({
  id: '22222222-2222-2222-2222-222222222222',
  subjectId: 'russian',
  conditionMd: 'Расставьте знаки препинания в предложении.',
});

describe('FavoritesList (real, server-backed favorites list — "избранное must actually list what was saved")', () => {
  beforeEach(() => {
    vi.mocked(api.removeFavorite).mockResolvedValue(undefined);
  });

  it('shows the empty state when nothing is favorited', async () => {
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [] });
    render(<FavoritesList subjectId="math" onSelect={vi.fn()} />);
    expect(await screen.findByText(/появятся здесь/)).toBeInTheDocument();
  });

  it('lists real favorited tasks scoped to the current subject, not other subjects', async () => {
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({
      taskIds: [MATH_TASK.id, OTHER_SUBJECT_TASK.id],
    });
    vi.mocked(api.getTask).mockImplementation((id) =>
      Promise.resolve(id === MATH_TASK.id ? MATH_TASK : OTHER_SUBJECT_TASK),
    );
    render(<FavoritesList subjectId="math" onSelect={vi.fn()} />);
    expect(await screen.findByText(MATH_TASK.conditionMd)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_SUBJECT_TASK.conditionMd)).not.toBeInTheDocument();
  });

  it('clicking a row calls onSelect with the real task, using the real task id — not a position/index', async () => {
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [MATH_TASK.id] });
    vi.mocked(api.getTask).mockResolvedValue(MATH_TASK);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<FavoritesList subjectId="math" onSelect={onSelect} />);
    const row = await screen.findByText(MATH_TASK.conditionMd);
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(MATH_TASK);
  });

  it('removing a favorite calls the real DELETE and drops it from the list immediately', async () => {
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [MATH_TASK.id] });
    vi.mocked(api.getTask).mockResolvedValue(MATH_TASK);
    const user = userEvent.setup();
    render(<FavoritesList subjectId="math" onSelect={vi.fn()} />);
    await screen.findByText(MATH_TASK.conditionMd);

    await user.click(screen.getByRole('button', { name: 'Убрать из избранного' }));

    expect(api.removeFavorite).toHaveBeenCalledWith(MATH_TASK.id);
    await waitFor(() => {
      expect(screen.queryByText(MATH_TASK.conditionMd)).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/появятся здесь/)).toBeInTheDocument();
  });

  it('re-fetches when the subject changes', async () => {
    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [MATH_TASK.id] });
    vi.mocked(api.getTask).mockResolvedValue(MATH_TASK);
    const { rerender } = render(<FavoritesList subjectId="math" onSelect={vi.fn()} />);
    await screen.findByText(MATH_TASK.conditionMd);

    vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [] });
    rerender(<FavoritesList subjectId="russian" onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.queryByText(MATH_TASK.conditionMd)).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/появятся здесь/)).toBeInTheDocument();
  });
});
