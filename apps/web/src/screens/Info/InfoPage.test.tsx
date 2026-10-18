import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InfoPage, type InfoPageKind } from './InfoPage.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider } from '../../lib/authTestUtils.js';
import { faq } from '../../data/siteInfo.js';

function renderPage(kind: InfoPageKind) {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={null}>
        <InfoPage kind={kind} />
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

describe('InfoPage', () => {
  it('FAQ: every question, and a way to reach support', () => {
    renderPage('faq');
    expect(screen.getByRole('heading', { level: 1, name: 'Вопросы и ответы' })).toBeInTheDocument();
    for (const item of faq) expect(screen.getByText(item.question)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Напишите в поддержку' })).toHaveAttribute(
      'href',
      '/help',
    );
  });

  it.each(['privacy', 'terms'] as const)(
    '%s: marked as a draft, with owner-only facts highlighted rather than invented',
    (kind) => {
      const { container } = renderPage(kind);
      expect(screen.getByRole('note')).toHaveTextContent(/Проект документа/);
      const marks = [...container.querySelectorAll('mark')];
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expect(mark.textContent).toMatch(/^\[Заполнить:.*\]$/);
    },
  );

  it('privacy policy states the real sign-in data and the 30-day session cookie', () => {
    renderPage('privacy');
    const main = screen.getByRole('main');
    expect(within(main).getByText(/адрес электронной почты/)).toBeInTheDocument();
    expect(within(main).getByText(/идентификатор пользователя VK/)).toBeInTheDocument();
    expect(within(main).getByText(/действует 30 дней/)).toBeInTheDocument();
    expect(within(main).getByText(/сторонних систем аналитики на сайте нет/)).toBeInTheDocument();
  });
});
