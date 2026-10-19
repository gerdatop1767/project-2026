import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { THEME_STORAGE_KEY, currentTheme, setTheme, useTheme } from './theme.js';

function Probe() {
  const [theme] = useTheme();
  return <p data-testid="theme">{theme}</p>;
}

describe('theme', () => {
  it('defaults to dark', () => {
    expect(currentTheme()).toBe('dark');
  });

  it('setTheme applies the attribute, colour scheme and storage, and re-renders readers', () => {
    render(<Probe />);
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => setTheme('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('updates the browser chrome colour', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#05070f';
    document.head.append(meta);
    setTheme('light');
    expect(meta.content).toBe('#f4f3fb');
    setTheme('dark');
    expect(meta.content).toBe('#05070f');
    meta.remove();
  });
});
