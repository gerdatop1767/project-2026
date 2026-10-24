import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Landing } from './Landing.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TestAuthProvider } from '../../lib/authTestUtils.js';
import { faq } from '../../data/siteInfo.js';

function OverlayMarker() {
  const { overlay, tab } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? `tab:${tab}`}</p>;
}

function renderLanding() {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={null}>
        <Landing />
        <OverlayMarker />
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

describe('Landing', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('has one h1 with the purple key word, and exactly one mascot image', () => {
    const { container } = renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/Подготовка к\s*ЕГЭ, которая работает/);
    expect(within(h1).getByText('работает')).toBeInTheDocument();

    const bison = [...container.querySelectorAll('img')]
      .map((img) => img.getAttribute('src') ?? '')
      .filter((src) => /mascot|logo-icon|zybrilka-logo/.test(src));
    expect(bison).toEqual(['/branding/v2/landing-mascot.webp']);
  });

  it('header has the section links, FAQ and "Войти" — and no "О нас" / "О проекте"', () => {
    renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getByRole('link', { name: 'Предметы' })).toHaveAttribute(
      'href',
      '#subjects',
    );
    expect(within(nav).getByRole('link', { name: 'Возможности' })).toHaveAttribute(
      'href',
      '#features',
    );
    expect(within(nav).getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '#faq');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    // The "О проекте" section is gone from the product: no link anywhere.
    expect(screen.queryByRole('link', { name: /О нас|О проекте/ })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('href', '/about');
    }
  });

  it('every CTA and subject card opens the unified auth screen', async () => {
    const user = userEvent.setup();
    renderLanding();
    const targets = [
      ...screen.getAllByRole('button', { name: /Начать бесплатно/ }),
      screen.getByRole('button', { name: 'Войти' }),
      screen.getByRole('button', { name: /Профильная математика/ }),
      screen.getByRole('button', { name: /Русский язык/ }),
    ];
    expect(targets).toHaveLength(6); // 3× «Начать бесплатно», «Войти», 2 subjects
    for (const target of targets) {
      window.history.replaceState(null, '', '/');
      await user.click(target);
      expect(screen.getByTestId('overlay')).toHaveTextContent('login');
    }
  });

  it('shows only subjects with real tasks — no counters, ratings or progress', () => {
    renderLanding();
    const section = screen.getByRole('heading', { name: 'Предметы' }).closest('section')!;
    expect(within(section).getAllByRole('button')).toHaveLength(2);
    expect(within(section).queryByText(/Английский|Обществознание/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/\d+\s*(задани|%)/)).not.toBeInTheDocument();
  });

  it('names only the real task sources', () => {
    renderLanding();
    const section = screen.getByRole('heading', { name: 'Источники заданий' }).closest('section')!;
    expect(within(section).getByText(/Ященко\. ЕГЭ 2026/)).toBeInTheDocument();
    expect(within(section).getByText(/Дощинский\. ЕГЭ 2027/)).toBeInTheDocument();
    expect(screen.queryByText(/ФИПИ|Статград|Семенов/)).not.toBeInTheDocument();
  });

  it('names the real sign-in methods — no email sign-in', () => {
    const { container } = renderLanding();
    expect(screen.getByText(/Нужен только вход — через VK ID или Яндекс ID/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/по почте/);
  });

  it('FAQ answers open on click (native details)', async () => {
    const user = userEvent.setup();
    renderLanding();
    const section = screen.getByRole('heading', { name: 'Вопросы и ответы' }).closest('section')!;
    expect(within(section).getAllByRole('group')).toHaveLength(faq.length);
    const first = within(section).getByText(faq[0]!.question);
    const details = first.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await user.click(first);
    expect(details).toHaveAttribute('open');
  });

  it('footer links reach the real info and legal pages', async () => {
    const user = userEvent.setup();
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    const expected: Record<string, string> = {
      'Вопросы и ответы': '/faq',
      'Политика конфиденциальности': '/privacy',
      'Пользовательское соглашение': '/terms',
    };
    for (const [name, href] of Object.entries(expected)) {
      expect(within(footer).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await user.click(within(footer).getByRole('link', { name: 'Политика конфиденциальности' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('privacy');
  });

  it('footer has no "О проекте", and "Поддержка" opens the support window instead of navigating', async () => {
    const user = userEvent.setup();
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText('О проекте')).not.toBeInTheDocument();
    expect(within(footer).queryByRole('link', { name: 'Поддержка' })).not.toBeInTheDocument();

    await user.click(within(footer).getByRole('button', { name: 'Поддержка' }));
    expect(screen.getByRole('dialog', { name: /Нужна помощь/ })).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).toHaveTextContent('tab:home');
    expect(window.location.pathname).toBe('/');
  });
});
