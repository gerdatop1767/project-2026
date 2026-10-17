import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileDesktop } from './ProfileDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';

vi.mock('../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getLearningProfile: vi.fn(),
  getIdentities: vi.fn(() =>
    Promise.resolve({
      identities: [{ provider: 'email' as const, linkedAt: '2026-01-01T00:00:00.000Z' }],
      available: { vk: true, telegram: false },
      canUnlink: false,
    }),
  ),
}));

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderProfile(from?: Parameters<typeof ProfileDesktop>[0]['from']) {
  return render(
    <NavigationProvider>
      <ProfileDesktop from={from} />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('ProfileDesktop', () => {
  beforeEach(() => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the personal/settings sections, not stats or achievements', () => {
    renderProfile();
    expect(screen.getByText('Мой профиль')).toBeInTheDocument();
    expect(screen.getByText('Личные данные')).toBeInTheDocument();
    expect(screen.getByText('Учебные настройки')).toBeInTheDocument();
    expect(screen.getByText('Настройки аккаунта')).toBeInTheDocument();
    expect(screen.getByText('Действия')).toBeInTheDocument();

    // The screens this deliberately does NOT duplicate.
    expect(screen.queryByText('Твой прогресс')).not.toBeInTheDocument();
    expect(screen.queryByText('Последние достижения')).not.toBeInTheDocument();
    expect(screen.queryByText(/место в рейтинге/i)).not.toBeInTheDocument();
  });

  it('never shows a fake username/level as if it were real user data', () => {
    renderProfile();
    expect(screen.queryByText('ZybrilkaUser')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Уровень \d/)).not.toBeInTheDocument();
    expect(screen.getByText('Имя не задано')).toBeInTheDocument();
  });

  it('shows a destructive "Выйти из аккаунта" action', () => {
    renderProfile();
    expect(screen.getByRole('button', { name: /Выйти из аккаунта/ })).toBeInTheDocument();
  });

  it('opens onboarding from "Предметы ЕГЭ" to edit the real learning profile', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: /Предметы ЕГЭ/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('onboarding');
  });

  it('shows a neutral prompt (not fabricated data) when no learning profile is saved yet', () => {
    renderProfile();
    expect(screen.getByText('Выбери предметы для подготовки')).toBeInTheDocument();
    expect(screen.getByText('Укажи текущий уровень')).toBeInTheDocument();
  });

  it('shows real saved subjects/levels/targets from /me/learning-profile', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [
        { subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' },
        { subjectId: 'russian', selfReportedScore: 'unknown', targetScore: '100' },
      ],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText(/Математика, Русский язык/)).toBeInTheDocument());
    expect(screen.getByText(/Математика: 70\+, Русский язык: Не знаю/)).toBeInTheDocument();
    expect(screen.getByText(/Математика: 90\+, Русский язык: 100/)).toBeInTheDocument();
  });

  it('BackRow with no `from` falls back to closing the overlay (default tab)', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Главная' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('BackRow with an explicit `from` returns to that exact route', async () => {
    const user = userEvent.setup();
    renderProfile({ screen: 'about' });
    await user.click(screen.getByRole('button', { name: 'О проекте' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('about');
  });
});
