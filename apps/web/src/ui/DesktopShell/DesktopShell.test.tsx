import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopShell } from './DesktopShell.js';
import { NavigationProvider } from '../../lib/navigation.js';

describe('DesktopShell', () => {
  it('sends the header logo/mascot to Учебный центр without a page reload', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <DesktopShell>
          <p>Content</p>
        </DesktopShell>
      </NavigationProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    expect(window.location.pathname).toBe('/learning');
  });

  it('keeps browser Back working after a logo navigation', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <DesktopShell>
          <p>Content</p>
        </DesktopShell>
      </NavigationProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    expect(window.location.pathname).toBe('/learning');
    window.history.back();
    // history.back() is asynchronous (even in jsdom): wait for it, don't race it.
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});
