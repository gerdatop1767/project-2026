import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';
import { NavigationProvider } from './lib/navigation.js';
import { ToastProvider } from './ui/Toast/ToastProvider.js';
import { makeAuthUser, TestAuthProvider } from './lib/authTestUtils.js';

// Both app trees fail to load, as with a dropped connection or a chunk
// removed by a new deploy.
vi.mock('./AppMobile.js', () => {
  throw new Error('Failed to fetch dynamically imported module');
});
vi.mock('./AppDesktop.js', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

describe('App — the app chunk fails to load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an error with «Обновить» instead of a blank screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <NavigationProvider>
        <TestAuthProvider user={makeAuthUser()}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </TestAuthProvider>
      </NavigationProvider>,
    );
    expect(await screen.findByText('Не удалось загрузить приложение')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });
});
