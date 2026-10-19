import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopMenu } from './DesktopMenu.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { AuthContext } from '../../lib/authContext.js';

function State() {
  const { overlay, tab } = useNavigation();
  return (
    <p data-testid="state">
      {tab}/{overlay?.screen ?? 'none'}
    </p>
  );
}

function renderMenu({ logout = vi.fn(async () => {}), onClose = vi.fn() } = {}) {
  render(
    <AuthContext.Provider
      value={{
        user: null,
        refresh: async () => {},
        logout,
        updateUser: () => {},
        telegramError: null,
      }}
    >
      <NavigationProvider>
        <DesktopMenu open onClose={onClose} />
        <State />
      </NavigationProvider>
    </AuthContext.Provider>,
  );
  return { logout, onClose };
}

describe('DesktopMenu', () => {
  it('shows the brand, Профиль/Помощь rows and Выйти', () => {
    renderMenu();
    expect(screen.getByRole('dialog', { name: 'Меню' })).toBeInTheDocument();
    expect(screen.getByText('Твой помощник в подготовке к ЕГЭ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Профиль/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Помощь/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Выйти/ })).toBeInTheDocument();
  });

  it('the theme switch flips the whole site and remembers the choice', async () => {
    const user = userEvent.setup();
    renderMenu();
    const toggle = screen.getByRole('switch', { name: 'Тёмная тема' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('zybrilka-theme')).toBe('light');
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('navigates from a row and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderMenu();
    await user.click(screen.getByRole('button', { name: /Помощь/ }));
    expect(screen.getByTestId('state')).toHaveTextContent('help');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on × and on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Закрыть меню' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Выйти ends the real session and reports a failure', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {
      throw new Error('offline');
    });
    renderMenu({ logout });
    await user.click(screen.getByRole('button', { name: /Выйти/ }));
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти');
  });
});
