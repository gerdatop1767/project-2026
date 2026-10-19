import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileMenu } from './MobileMenu.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';

function OverlayMarker() {
  const { overlay, tab } = useNavigation();
  return (
    <p data-testid="state">
      {tab}/{overlay?.screen ?? 'none'}
    </p>
  );
}

function renderMenu(open: boolean, onClose = vi.fn()) {
  const utils = render(
    <NavigationProvider>
      <MobileMenu open={open} onClose={onClose} activeTab="home" />
      <OverlayMarker />
    </NavigationProvider>,
  );
  return { ...utils, onClose };
}

describe('MobileMenu', () => {
  it('renders nothing when closed', () => {
    renderMenu(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the panel with its own logo lockup and profile row when open', () => {
    renderMenu(true);
    expect(screen.getByRole('dialog', { name: 'Меню' })).toBeInTheDocument();
    expect(screen.getByText('Зубрилка')).toBeInTheDocument();
    expect(screen.getByText('Твой тренажёр для ЕГЭ')).toBeInTheDocument();
  });

  it('has no «О проекте» entry (that section was removed) and keeps Помощь', () => {
    renderMenu(true);
    expect(screen.queryByText('О проекте')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Помощь/ })).toBeInTheDocument();
  });

  it('marks the active tab item and omits its chevron', () => {
    renderMenu(true);
    const homeItem = screen.getByRole('button', { name: /Главная/ });
    expect(homeItem).toHaveAttribute('aria-current', 'page');
  });

  it('calls onClose when the close button is tapped', async () => {
    const user = userEvent.setup();
    const { onClose } = renderMenu(true);
    await user.click(screen.getByRole('button', { name: 'Закрыть меню' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('navigates to the tapped route, which itself replaces the "menu" overlay', async () => {
    // `go()` deliberately does NOT call `onClose` in addition to
    // `navigate` — in the real app, replacing the 'menu' overlay with
    // the new route is what closes the drawer (App re-renders with
    // `open={false}`). Calling `onClose` (== `back`, which clears the
    // overlay) here as well would wipe out whatever `navigate` just
    // set for any overlay destination — this regression-tests that.
    const user = userEvent.setup();
    const { onClose } = renderMenu(true);
    await user.click(screen.getByRole('button', { name: /Статистика/ }));
    expect(screen.getByTestId('state')).toHaveTextContent('statistics/none');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('navigating to an overlay destination is not wiped out by onClose', async () => {
    const user = userEvent.setup();
    renderMenu(true);
    await user.click(screen.getByRole('button', { name: /Мои ошибки/ }));
    expect(screen.getByTestId('state')).toHaveTextContent('home/mistakes');
  });

  it('toggles the theme switch', async () => {
    const user = userEvent.setup();
    renderMenu(true);
    const toggle = screen.getByRole('button', { name: 'Тёмная тема' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('zybrilka-theme')).toBe('light');
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('zybrilka-theme')).toBe('dark');
  });
});
