import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeDesktop } from './HomeDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';

function OverlayMarker() {
  const { overlay, tab } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? tab}</p>;
}

function renderHome() {
  return render(
    <NavigationProvider>
      <HomeDesktop />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('HomeDesktop', () => {
  it('renders the marketing headline, not the mobile dashboard greeting', () => {
    renderHome();
    expect(screen.getByText(/ЕГЭ становится проще/)).toBeInTheDocument();
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
  });

  it('renders the feature bullets', () => {
    renderHome();
    expect(screen.getByText('предметов')).toBeInTheDocument();
    expect(screen.getByText('заданий')).toBeInTheDocument();
  });

  it('renders a single "Начать бесплатно" CTA — no separate "О проекте" or "Войти"', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /Начать бесплатно/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /О проекте/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Войти' })).not.toBeInTheDocument();
  });

  it('"Начать бесплатно" opens the unified auth screen', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('login');
  });
});
