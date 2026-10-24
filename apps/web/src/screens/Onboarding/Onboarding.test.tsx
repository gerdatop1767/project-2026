import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from './Onboarding.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';

vi.mock('../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getLearningProfile: vi.fn(),
  saveLearningProfile: vi.fn(),
}));

function TabMarker() {
  const { tab, overlay } = useNavigation();
  return <p data-testid="nav">{overlay ? overlay.screen : tab}</p>;
}

function renderOnboarding() {
  return render(
    <NavigationProvider>
      <Onboarding />
      <TabMarker />
    </NavigationProvider>,
  );
}

describe('Onboarding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts on the welcome step', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    renderOnboarding();
    expect(
      screen.getByRole('heading', { name: 'Добро пожаловать в Zybrilka!' }),
    ).toBeInTheDocument();
  });

  it('progresses through subject selection to the current-level step', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    expect(screen.getByRole('heading', { name: 'Какие предметы сдаёшь?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Далее' }));
    expect(
      screen.getByRole('heading', { name: 'Примерно на сколько ты сейчас пишешь?' }),
    ).toBeInTheDocument();
  });

  it('requires a self-reported score per selected subject before continuing to target', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Далее' })); // math is pre-selected

    const next = screen.getByRole('button', { name: 'Далее' });
    expect(next).toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: '70+' })[0]!);
    expect(next).toBeEnabled();
  });

  it('"Не знаю" is a valid, accepted self-reported level (not an error)', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));

    const next = screen.getByRole('button', { name: 'Далее' });
    await user.click(screen.getAllByRole('button', { name: 'Не знаю' })[0]!);
    expect(next).toBeEnabled();
  });

  it('requires a target score before reaching the finish step', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getAllByRole('button', { name: '70+' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    expect(
      screen.getByRole('heading', { name: 'Какой результат хочешь получить?' }),
    ).toBeInTheDocument();

    const next = screen.getByRole('button', { name: 'Далее' });
    expect(next).toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: '90+' })[0]!);
    expect(next).toBeEnabled();
  });

  it('finishing saves the profile via the API and navigates to Home', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    vi.mocked(api.saveLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getAllByRole('button', { name: '70+' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getAllByRole('button', { name: '90+' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByRole('heading', { name: 'Почти готово!' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перейти к тренировкам' }));

    await waitFor(() => {
      expect(api.saveLearningProfile).toHaveBeenCalledWith({
        subjects: [{ subjectId: 'math', selfReportedScore: '70_plus', targetScore: '90_plus' }],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('nav')).toHaveTextContent('home');
    });
  });

  it('shows an error and stays on the finish step if saving fails', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    vi.mocked(api.saveLearningProfile).mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getAllByRole('button', { name: '70+' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getAllByRole('button', { name: '90+' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Перейти к тренировкам' }));

    await screen.findByText('Не удалось сохранить профиль. Попробуй ещё раз.');
    expect(screen.getByRole('heading', { name: 'Почти готово!' })).toBeInTheDocument();
    expect(api.saveLearningProfile).toHaveBeenCalledTimes(1);
  });

  it('closes the onboarding overlay from the first step’s back button', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByTestId('nav')).toHaveTextContent('home');
  });

  it('resumes an already-saved profile instead of starting blank', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [
        { subjectId: 'math', selfReportedScore: '60_plus', targetScore: '80_plus' },
        { subjectId: 'russian', selfReportedScore: '50_plus', targetScore: '70_plus' },
      ],
    });
    const user = userEvent.setup();
    renderOnboarding();
    await waitFor(() => expect(api.getLearningProfile).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    expect(screen.getByRole('checkbox', { name: /Математика/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: /Русский язык/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
