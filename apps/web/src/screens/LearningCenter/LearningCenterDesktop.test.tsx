import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearningCenterDesktop } from './LearningCenterDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import { subjectIconSrc, type SubjectIconId } from '../../ui/SubjectIcon/subjectIcons.js';

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderLearningCenter({ needsSignInMethod = false } = {}) {
  return render(
    <TestAuthProvider user={makeAuthUser()} needsSignInMethod={needsSignInMethod}>
      <NavigationProvider>
        <LearningCenterDesktop />
        <OverlayMarker />
      </NavigationProvider>
    </TestAuthProvider>,
  );
}

describe('LearningCenterDesktop', () => {
  it('warns only an account with no working sign-in method, and leads to Профиль', async () => {
    const { unmount } = renderLearningCenter();
    expect(screen.queryByText('Подключите VK ID или Яндекс ID')).not.toBeInTheDocument();
    unmount();
    renderLearningCenter({ needsSignInMethod: true });
    expect(screen.getByText('Подключите VK ID или Яндекс ID')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Подключить в профиле' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('profile');
  });

  it('renders the four section cards with their real illustrations and an arrow each', () => {
    renderLearningCenter();
    const sectionIcons: Record<string, string> = {
      Теория: 'theory',
      Практика: 'practice',
      Стратегии: 'strategy',
      'Полезные материалы': 'materials',
    };
    for (const [title, icon] of Object.entries(sectionIcons)) {
      expect(screen.getByText(title)).toBeInTheDocument();
      // The section's own animated line icon, decorative (the title names it).
      const iconEl = document.querySelector(`[data-icon="${icon}"]`);
      expect(iconEl).toBeInTheDocument();
      expect(iconEl).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  it('renders all 9 subjects using the shared subject illustrations', () => {
    renderLearningCenter();
    for (const subject of subjects) {
      expect(
        document.querySelector(`img[src="${subjectIconSrc(subject.id as SubjectIconId)}"]`),
      ).toBeInTheDocument();
    }
  });

  it('opens the subject catalog when a subject row is clicked', async () => {
    const user = userEvent.setup();
    renderLearningCenter();
    await user.click(screen.getByText('Математика'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });

  it('«Рекомендации для тебя» is an honest placeholder — no invented picks', () => {
    renderLearningCenter();
    expect(screen.getByText('Рекомендации появятся позже')).toBeInTheDocument();
    expect(screen.queryByText('Популярное')).not.toBeInTheDocument();
    expect(screen.queryByText('Типовые задания')).not.toBeInTheDocument();
  });

  it('the section cards lead to the theory and to the library', async () => {
    const user = userEvent.setup();
    renderLearningCenter();
    await user.click(screen.getByRole('button', { name: 'Стратегии' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('library');
    expect(window.location.pathname).toBe('/strategies');
  });

  it('the search finds theory, materials and strategies, highlights matches and says when nothing is found', async () => {
    const user = userEvent.setup();
    renderLearningCenter();
    const input = screen.getByRole('searchbox', { name: 'Поиск материалов' });
    await user.type(input, 'производн');
    const results = await screen.findByRole('region', { name: 'Результаты поиска' });
    expect(results).toHaveTextContent('Таблица производных и правила дифференцирования');
    expect(results).toHaveTextContent('Теория');
    expect(results.querySelector('mark')).toHaveTextContent(/производн/i);
    // While searching, the section cards step aside.
    expect(screen.queryByText('Выбери предмет')).not.toBeVisible();
    await user.clear(input);
    await user.type(input, 'абракадабра');
    expect(await screen.findByText(/ничего не найдено/)).toBeInTheDocument();
  });
});
