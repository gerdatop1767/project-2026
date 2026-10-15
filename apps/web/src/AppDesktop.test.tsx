import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppDesktop } from './AppDesktop.js';
import { NavigationProvider, useNavigation } from './lib/navigation.js';
import * as api from './lib/api.js';

vi.mock('./lib/api.js', () => ({
  getRandomTask: vi.fn(),
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(),
  getProgressSummary: vi.fn(() => new Promise(() => {})),
  getVariantProgress: vi.fn(() => new Promise(() => {})),
  getTaskCountsBySubject: vi.fn(() => new Promise(() => {})),
  getProgressByTaskNumber: vi.fn(() => new Promise(() => {})),
  getProgressByTopic: vi.fn(() => new Promise(() => {})),
  getTaskNumberStatisticsDetail: vi.fn(() => new Promise(() => {})),
  getMistakes: vi.fn(() => new Promise(() => {})),
  getLearningProfile: vi.fn(() => new Promise(() => {})),
  listFavoriteTaskIds: vi.fn(() => Promise.resolve({ taskIds: [] })),
  addFavorite: vi.fn(() => Promise.resolve()),
  removeFavorite: vi.fn(() => Promise.resolve()),
  listCollections: vi.fn(() => Promise.resolve([])),
  getVariant: vi.fn(),
  startLearningSession: vi.fn(),
  getLearningSessionNext: vi.fn(),
  getLearningSession: vi.fn(),
}));

const RANDOM_TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 5,
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

function renderApp() {
  return render(
    <NavigationProvider>
      <AppDesktop />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('AppDesktop — Subject → Задания по номерам → task → Back (routing fix)', () => {
  it('Back from the started task returns to Задания по номерам, not Subject or a hardcoded Тренировка', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    vi.mocked(api.listTasksByNumber).mockResolvedValue([RANDOM_TASK]);
    renderApp();

    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
    await user.click(screen.getByRole('button', { name: 'Предметы' }));
    await user.click(await screen.findByText('Математика'));
    await user.click(await screen.findByText('Задания по номерам'));
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent('trainingByNumber'),
    );

    await user.click(await screen.findByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent('trainingByNumber'),
    );
    expect(screen.getByRole('button', { name: '№5' })).toBeInTheDocument();
  });
});
