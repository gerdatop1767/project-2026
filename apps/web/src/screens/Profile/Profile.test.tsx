import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profile } from './Profile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { ToastProvider } from '../../ui/Toast/ToastProvider.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getProgressSummary: vi.fn(),
  getLearningProfile: vi.fn(),
}));

function OverlayMarker() {
  const { overlay, tab } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? tab}</p>;
}

function renderProfile() {
  return render(
    <NavigationProvider>
      <ToastProvider>
        <Profile />
        <OverlayMarker />
      </ToastProvider>
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
  vi.mocked(api.getLearningProfile).mockResolvedValue({ onboardingCompleted: false, subjects: [] });
});

describe('Profile', () => {
  // Regression test for the mobile page flash: this used to show a
  // fabricated "0" / "0%" while `getProgressSummary` was still in
  // flight — indistinguishable from a real zero, and clearly visible
  // during this screen's entrance animation (confirmed via frame-by-
  // frame video). Must show an honest '···' placeholder instead, never
  // a fake zero masquerading as real data.
  it('shows an honest loading placeholder before real progress data has loaded, never a fabricated 0/0%', () => {
    let resolveProgress!: (value: Awaited<ReturnType<typeof api.getProgressSummary>>) => void;
    vi.mocked(api.getProgressSummary).mockReturnValue(
      new Promise((resolve) => {
        resolveProgress = resolve;
      }),
    );
    renderProfile();
    expect(screen.getAllByText('···').length).toBeGreaterThan(0);
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // Resolve so this test doesn't leak a pending promise into the next one.
    resolveProgress({
      solvedTotal: 0,
      correctTotal: 0,
      incorrectTotal: 0,
      accuracyPercent: 0,
      bySubject: [],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
  });

  it('a real solvedTotal/accuracyPercent of 0 renders as a real 0, not a placeholder', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('0%')).toBeInTheDocument());
  });

  it('renders real solved/accuracy numbers from /progress/summary', async () => {
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 42,
      correctTotal: 30,
      incorrectTotal: 12,
      accuracyPercent: 71,
      bySubject: [],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument(), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText('71%')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('shows a neutral placeholder for achievements, never fake unlock data', () => {
    renderProfile();
    expect(screen.getByText('Достижения')).toBeInTheDocument();
    expect(screen.getByText('Достижения скоро появятся здесь.')).toBeInTheDocument();
  });

  it('navigates to onboarding from the settings entry point', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: /Пройти диагностику заново/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('onboarding');
  });

  it('shows a prompt (not fabricated data) when no learning profile is saved yet', () => {
    renderProfile();
    expect(screen.getByText('Предметы и цели ещё не выбраны.')).toBeInTheDocument();
  });

  it('shows real saved subjects/levels/targets from /me/learning-profile', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText('Математика')).toBeInTheDocument());
    expect(screen.getByText(/Сейчас: 70\+ · Цель: 90\+/)).toBeInTheDocument();
  });

  it('opens onboarding from "Изменить предметы и цели" once a profile exists', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    const user = userEvent.setup();
    renderProfile();
    await screen.findByText('Изменить предметы и цели');
    await user.click(screen.getByRole('button', { name: /Изменить предметы и цели/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('onboarding');
  });

  it('never fabricates a name/avatar — shows the honest "не задано" identity, same convention as Desktop', () => {
    renderProfile();
    expect(screen.getByText('Имя не задано')).toBeInTheDocument();
    expect(screen.getByText('Профиль ещё не настроен')).toBeInTheDocument();
  });

  it('shows the real per-subject accuracy from /progress/summary on the subject row, never a fabricated percent', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 12,
      correctTotal: 9,
      incorrectTotal: 3,
      accuracyPercent: 75,
      bySubject: [
        { subjectId: 'math', solved: 12, correct: 9, accuracyPercent: 75, uniqueSolved: 12 },
      ],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('shows an honest "—" (not 0%) for a subject with no solved attempts yet', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    renderProfile();
    await screen.findByText('Математика');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('navigates to the real subject page when a subject row is tapped', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByText('Математика'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });

  it('navigates to the real Достижения tab via "Все достижения", never showing fake unlock progress', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Все достижения' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('achievements');
  });

  it('navigates to the real notifications route from the settings "Уведомления" row', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: /Уведомления/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('notifications');
  });

  it('opens the Menu drawer (Рейтинг/Настройки/Помощь/О проекте…) via the header gear button', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('menu');
  });
});
