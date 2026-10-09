import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeMobile } from './HomeMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getRandomTask: vi.fn(),
  getProgressSummary: vi.fn(),
  getTaskCountsBySubject: vi.fn(),
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
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderHome() {
  return render(
    <NavigationProvider>
      <HomeMobile />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

beforeEach(() => {
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

describe('HomeMobile', () => {
  it('renders the hero greeting and CTA', () => {
    renderHome();
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Начать тренировку/ })).toBeInTheDocument();
  });

  it('renders real solved/accuracy numbers from /progress/summary, not the demo profile', async () => {
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 248,
      correctTotal: 203,
      incorrectTotal: 45,
      accuracyPercent: 82,
      bySubject: [],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('248')).toBeInTheDocument());
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('shows a neutral dash for streak, never a fabricated day count', () => {
    renderHome();
    expect(screen.getByText('Серия')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows 0/0% before the real progress data has loaded, never a fabricated fallback', () => {
    renderHome();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders every popular subject as a tappable card', () => {
    renderHome();
    for (const subject of subjects.slice(0, 6)) {
      expect(screen.getAllByText(subject.shortName).length).toBeGreaterThan(0);
    }
  });

  it('navigates to a subject overlay when a subject card is tapped', async () => {
    const user = userEvent.setup();
    renderHome();
    const subjectCard = screen.getAllByRole('button', { name: /Математика/ })[0];
    await user.click(subjectCard!);
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });

  it('navigates to the subject catalog when the hero CTA is tapped, not a WIP training tab', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Начать тренировку/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subjectCatalog');
  });

  it('navigates to the subject catalog from "Все тренировки", not a WIP training tab', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Все тренировки/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subjectCatalog');
  });

  it('navigates to the continue-training task', async () => {
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Тренировка · случайные задания/ }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task');
    });
  });

  it('shows a real subject illustration for every popular subject, not a flat glyph tile', () => {
    renderHome();
    for (const subject of subjects.slice(0, 6)) {
      expect(
        document.querySelector(`img[src="/branding/v2/subjects/${subject.id}.png"]`),
      ).toBeInTheDocument();
    }
  });

  it('keeps the hero heading/subtitle width-capped so the floating subject tiles never crowd them', () => {
    const { container } = renderHome();
    const heroTiles = container.querySelector('[aria-hidden="true"]');
    expect(heroTiles).toBeInTheDocument();
    expect(heroTiles!.querySelectorAll('img').length).toBe(3);
  });
});
