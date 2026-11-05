import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomNav } from './BottomNav.js';
import { defaultBottomNavItems } from './defaultItems.js';

describe('BottomNav', () => {
  it('renders all 5 default items', () => {
    render(<BottomNav items={defaultBottomNavItems} activeId="home" onSelect={() => {}} />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Главная/ })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onSelect with the tapped item id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BottomNav items={defaultBottomNavItems} activeId="home" onSelect={onSelect} />);
    await user.click(screen.getByRole('link', { name: /Профиль/ }));
    expect(onSelect).toHaveBeenCalledWith('profile');
  });

  it('marks exactly one item aria-current when the active id changes, never two at once', () => {
    const { rerender } = render(
      <BottomNav items={defaultBottomNavItems} activeId="mistakes" onSelect={() => {}} />,
    );
    expect(screen.getByRole('link', { name: /Мои ошибки/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    rerender(<BottomNav items={defaultBottomNavItems} activeId="profile" onSelect={() => {}} />);
    const current = screen
      .getAllByRole('link')
      .filter((button) => button.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/Профиль/);
  });

  // Regression guard for the mobile bottom-nav flash: BottomNav.module.css's
  // `.item` must never carry a CSS transition on `color`. With one, the
  // outgoing active item's color fades out and the incoming one fades in
  // independently and concurrently, so for the whole transition both sit
  // at some intermediate accent shade at once — visible on real devices
  // as two "active-looking" tabs for ~120ms on every tap (confirmed via
  // frame-by-frame video analysis). A tab bar's selection must switch
  // atomically, like a native iOS/Android tab bar — see the comment in
  // BottomNav.module.css for the full writeup.
  it('never transitions .item color (the actual cause of the two-active-tabs flash)', () => {
    const cssPath = path.join(__dirname, 'BottomNav.module.css');
    const css = readFileSync(cssPath, 'utf-8');
    const itemRuleMatch = css.match(/\.item\s*\{([^}]*)\}/);
    expect(itemRuleMatch).toBeTruthy();
    expect(itemRuleMatch![1]).not.toMatch(/transition:\s*color/);
  });
});
