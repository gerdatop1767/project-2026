import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpDesktop } from './HelpDesktop.js';
import { HelpMobile } from './HelpMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { SUPPORT_BOT_URL } from '../../lib/telegram.js';

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderWithNav(ui: React.ReactElement) {
  return render(
    <NavigationProvider>
      {ui}
      <OverlayMarker />
    </NavigationProvider>,
  );
}

const expectedCategories = [
  'Предложения',
  'Технические проблемы',
  'Проблемы с входом',
  'Другие запросы',
];

describe('HelpDesktop', () => {
  it('shows the hero heading and exactly the four approved categories', () => {
    renderWithNav(<HelpDesktop />);
    expect(screen.getByText('Нужна')).toBeInTheDocument();
    expect(screen.getByText('помощь?')).toBeInTheDocument();

    for (const title of expectedCategories) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText('Проблемы с заданиями')).not.toBeInTheDocument();
    expect(screen.queryByText('Статистика')).not.toBeInTheDocument();
  });

  it("links the CTA and every category to the real support bot (the landing's link)", () => {
    renderWithNav(<HelpDesktop />);
    const cta = screen.getByRole('link', { name: /Открыть Telegram-бота/ });
    expect(cta).toHaveAttribute('href', SUPPORT_BOT_URL);
    expect(cta).toHaveAttribute('target', '_blank');
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    for (const title of expectedCategories) {
      expect(screen.getByRole('link', { name: new RegExp(title) })).toHaveAttribute(
        'href',
        SUPPORT_BOT_URL,
      );
    }
    expect(screen.queryByText(/скоро будет подключ/)).not.toBeInTheDocument();
  });

  it('shows the landing support mascot, not the old hero picture', () => {
    const { container } = renderWithNav(<HelpDesktop />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/branding/v2/support-bison.webp');
  });
});

describe('HelpMobile', () => {
  it('shows the hero heading and all four categories in a single column', () => {
    renderWithNav(<HelpMobile />);
    expect(screen.getByText('Нужна')).toBeInTheDocument();
    for (const title of expectedCategories) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('links to the real support bot as well', () => {
    renderWithNav(<HelpMobile />);
    expect(screen.getByRole('link', { name: /Открыть Telegram-бота/ })).toHaveAttribute(
      'href',
      SUPPORT_BOT_URL,
    );
    expect(screen.queryByText(/скоро будет подключ/)).not.toBeInTheDocument();
  });

  it('back button closes the overlay', async () => {
    const user = userEvent.setup();
    renderWithNav(<HelpMobile />);
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });
});
