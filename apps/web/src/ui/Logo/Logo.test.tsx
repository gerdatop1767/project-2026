import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Logo } from './Logo.js';

describe('Logo', () => {
  it('renders the wordmark as real text plus a decorative icon', () => {
    render(<Logo />);
    expect(screen.getByText('Zybr')).toBeInTheDocument();
    expect(screen.getByText('ilka')).toBeInTheDocument();
    // The wordmark already conveys "Zybrilka" accessibly, so the icon
    // next to it is decorative and must not repeat the same name.
    expect(screen.queryByRole('img', { name: 'Zybrilka' })).not.toBeInTheDocument();
  });

  it('uses the desktop icon crop by default and the mobile crop when requested', () => {
    const { rerender } = render(<Logo />);
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/branding/v2/logo-icon-desktop.webp',
    );
    rerender(<Logo icon="mobile" />);
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/branding/v2/logo-icon-mobile.webp',
    );
  });

  it('falls back to an accessible icon label when the wordmark is hidden', () => {
    render(<Logo wordmark={false} />);
    expect(screen.getByRole('img', { name: 'Zybrilka' })).toBeInTheDocument();
  });

  it('sizes the icon by the given size', () => {
    render(<Logo size={40} />);
    expect(document.querySelector('img')).toHaveAttribute('height', '40');
  });

  it('renders as inert decoration with no onClick given', () => {
    render(<Logo />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a single clickable control — logo text and mascot icon both trigger it — when given an onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Logo onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Zybrilka — Учебный центр' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    // The mascot icon is inside the same clickable control, not a
    // separate target — clicking it fires the same handler.
    await user.click(within(button).getByRole('presentation'));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
