import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LEADERBOARD_AVATAR_VARIANTS } from '@zybrilka/shared';
import { AVATAR_GLYPHS, GeneratedAvatar } from './GeneratedAvatar.js';

describe('GeneratedAvatar', () => {
  it('has exactly one distinct picture per server variant', () => {
    expect(AVATAR_GLYPHS).toHaveLength(LEADERBOARD_AVATAR_VARIANTS);
    expect(new Set(AVATAR_GLYPHS).size).toBe(LEADERBOARD_AVATAR_VARIANTS);
  });

  it('renders the same picture for the same input, decorative, no image request', () => {
    const a = render(<GeneratedAvatar hue={120} variant={5} />).container.innerHTML;
    const b = render(<GeneratedAvatar hue={120} variant={5} />).container.innerHTML;
    expect(a).toBe(b);
    const { container } = render(<GeneratedAvatar hue={10} variant={99} />);
    const el = container.querySelector('[data-avatar-variant]')!;
    expect(el.getAttribute('data-avatar-variant')).toBe(String(99 % LEADERBOARD_AVATAR_VARIANTS));
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('img')).toBeNull();
  });

  it('survives a response without a variant (older API during a deploy)', () => {
    const { container } = render(
      <GeneratedAvatar hue={200} variant={undefined as unknown as number} />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
