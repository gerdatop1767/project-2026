import { describe, expect, it, vi } from 'vitest';
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
      expect(screen.getByRole('link', { name: title })).toBeInTheDocument();
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

  it('«Рекомендации для тебя» shows the Learning Engine’s real picks with their reason', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/me/learning/recommendations')) {
        return new Response(
          JSON.stringify({
            recommendations: [
              {
                subjectId: 'math',
                skillKey: 'math.equations-advanced',
                examNumber: 13,
                title: 'Уравнения (развёрнутый ответ)',
                kind: 'weak',
                priority: 80,
                reason: 'За последние 7 попыток — 3 ошибки. Освоение 35%.',
                benefit: 'Задание второй части.',
                suggestedTasks: 5,
                taskIds: ['t1', 't2', 't3', 't4', 't5'],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderLearningCenter();
      expect(
        await screen.findByText('За последние 7 попыток — 3 ошибки. Освоение 35%.'),
      ).toBeInTheDocument();
      expect(screen.getByText('№13')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Начать · 5 заданий/ })).toBeInTheDocument();
      expect(screen.queryByText('Рекомендации появятся позже')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the section cards lead to the theory and to the library', async () => {
    const user = userEvent.setup();
    renderLearningCenter();
    await user.click(screen.getByRole('link', { name: 'Стратегии' }));
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
