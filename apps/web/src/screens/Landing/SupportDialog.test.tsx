import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Landing } from './Landing.js';
import { InfoPage } from '../Info/InfoPage.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider } from '../../lib/authTestUtils.js';
import { SupportDialogProvider, useSupportDialog } from './SupportDialog.js';
import { SUPPORT_BOT_URL } from '../../lib/telegram.js';

/** The app mounts into #root; the window must make exactly that inert. */
let root: HTMLDivElement;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
  document.body.removeAttribute('style');
});

function renderLanding() {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={null}>
        <Landing />
      </TestAuthProvider>
    </NavigationProvider>,
    { container: root },
  );
}

const footerSupport = () =>
  within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Поддержка' });
const dialog = () => screen.getByRole('dialog', { name: /Нужна помощь/ });
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

describe('Support window on the public landing', () => {
  it('"Поддержка" is a button that opens a window OVER the page — nothing navigates', async () => {
    const user = userEvent.setup();
    renderLanding();
    const length = window.history.length;

    await user.click(footerSupport());

    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(length);
    // The landing is still there underneath, untouched.
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toBeInTheDocument();
    // …and is not the app's internal Help screen.
    expect(screen.queryByRole('navigation', { name: 'Zybrilka' })).not.toBeInTheDocument();
  });

  it('is no longer a link to the internal /help screen', () => {
    renderLanding();
    expect(
      within(screen.getByRole('contentinfo')).queryByRole('link', { name: 'Поддержка' }),
    ).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('href', '/help');
    }
  });

  it('has short copy, the Telegram bot link that opens safely in a new tab, the new mascot, and no promises', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(footerSupport());

    const win = within(dialog());
    const link = win.getByRole('link', { name: /Открыть Telegram-бота/ });
    expect(link).toHaveAttribute('href', 'https://t.me/zybrilka_bot');
    expect(SUPPORT_BOT_URL).toBe('https://t.me/zybrilka_bot');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
    expect(link).toHaveAccessibleName(/откроется в новой вкладке/);
    expect(win.getByText('@zybrilka_bot')).toBeInTheDocument();

    const mascot = dialog().querySelector('img')!;
    expect(mascot).toHaveAttribute('src', '/branding/v2/support-bison.webp');
    expect(mascot).toHaveAttribute('alt', '');
    expect(mascot.closest('[aria-hidden="true"]')).not.toBeNull();

    // No response-time promises or invented statuses.
    expect(dialog().textContent).not.toMatch(/скор|минут|час|онлайн|ответим/i);
  });

  it('closes with ×, with Escape and with a tap on the backdrop — and gives focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(footerSupport());
    await user.click(within(dialog()).getByRole('button', { name: 'Закрыть' }));
    await closed();
    await waitFor(() => expect(footerSupport()).toHaveFocus());

    await user.click(footerSupport());
    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(footerSupport()).toHaveFocus());

    await user.click(footerSupport());
    const backdrop = dialog().parentElement!.querySelector('[aria-hidden="true"]')!;
    await user.click(backdrop);
    await closed();
    await waitFor(() => expect(footerSupport()).toHaveFocus());
  });

  it('hands focus back only AFTER the page is no longer inert (an inert page refuses focus in a real browser)', async () => {
    const user = userEvent.setup();
    renderLanding();
    const seen: { text: string; inert: boolean }[] = [];
    const original = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
      ...args: Parameters<HTMLElement['focus']>
    ) {
      seen.push({ text: this.textContent?.trim() ?? '', inert: root.hasAttribute('inert') });
      return original.apply(this, args);
    });

    await user.click(footerSupport());
    await user.keyboard('{Escape}');
    await closed();
    spy.mockRestore();

    const restore = seen.filter((call) => call.text === 'Поддержка');
    expect(restore.length).toBeGreaterThan(0);
    for (const call of restore) expect(call.inert).toBe(false);
    expect(footerSupport()).toHaveFocus();
  });

  it('does not close when the window itself (or its Telegram link) is clicked', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(footerSupport());
    await user.click(within(dialog()).getByText(/Что-то не работает/));
    await user.click(within(dialog()).getByRole('link', { name: /Открыть Telegram-бота/ }));
    expect(dialog()).toBeInTheDocument();
  });

  it('can be opened with the keyboard, takes focus, and keeps Tab / Shift+Tab inside', async () => {
    const user = userEvent.setup();
    renderLanding();
    footerSupport().focus();
    await user.keyboard('{Enter}');

    expect(dialog()).toHaveFocus();
    const close = within(dialog()).getByRole('button', { name: 'Закрыть' });
    const link = within(dialog()).getByRole('link', { name: /Открыть Telegram-бота/ });

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(link).toHaveFocus();
    await user.tab(); // wraps instead of escaping to the page behind
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(link).toHaveFocus();

    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(footerSupport()).toHaveFocus());
  });

  it('makes the page behind inert and stops it scrolling while open, and restores both on close', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    renderLanding();
    expect(root).not.toHaveAttribute('inert');

    await user.click(footerSupport());
    expect(root).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(root).not.toHaveAttribute('inert'));
    await waitFor(() => expect(document.body.style.overflow).toBe('auto'));
  });

  it('can be opened again after closing', async () => {
    const user = userEvent.setup();
    renderLanding();
    for (let round = 0; round < 3; round += 1) {
      await user.click(footerSupport());
      expect(dialog()).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await closed();
    }
  });

  it('releases the page (inert, scroll lock) even if the whole page unmounts while it is open', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLanding();
    await user.click(footerSupport());
    expect(root).toHaveAttribute('inert');
    unmount();
    expect(root).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Support window on the other public pages', () => {
  it('the FAQ page\'s "Напишите в поддержку" opens the same window and returns focus to it', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <TestAuthProvider user={null}>
          <InfoPage kind="faq" />
        </TestAuthProvider>
      </NavigationProvider>,
      { container: root },
    );
    const ask = screen.getByRole('button', { name: 'Напишите в поддержку' });
    await user.click(ask);
    expect(dialog()).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(ask).toHaveFocus());
  });

  it('the legal pages\' footer "Поддержка" opens it too', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <TestAuthProvider user={null}>
          <InfoPage kind="privacy" />
        </TestAuthProvider>
      </NavigationProvider>,
      { container: root },
    );
    await user.click(footerSupport());
    expect(dialog()).toBeInTheDocument();
  });
});

describe('useSupportDialog', () => {
  it('fails loudly outside a provider instead of rendering a dead button', () => {
    function Orphan() {
      useSupportDialog();
      return null;
    }
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Orphan />)).toThrow(/SupportDialogProvider/);
    } finally {
      console.error = spy;
    }
  });

  it('works for any element that opens it, returning focus to that element', async () => {
    const user = userEvent.setup();
    function Opener() {
      const support = useSupportDialog();
      return <button onClick={(event) => support.open(event.currentTarget)}>help-me</button>;
    }
    render(
      <SupportDialogProvider>
        <Opener />
      </SupportDialogProvider>,
      { container: root },
    );
    await user.click(screen.getByText('help-me'));
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await closed();
    await waitFor(() => expect(screen.getByText('help-me')).toHaveFocus());
  });
});
