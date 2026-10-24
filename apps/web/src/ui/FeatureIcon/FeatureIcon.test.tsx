import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FeatureIcon, featureIconGlow, type FeatureIconName } from './FeatureIcon.js';

const names: FeatureIconName[] = [
  'subjects',
  'tasks',
  'statistics',
  'theory',
  'practice',
  'strategy',
  'materials',
];

describe('FeatureIcon', () => {
  it.each(names)('"%s" renders a decorative glyph with its own accent colour', (name) => {
    const { container } = render(<FeatureIcon name={name} />);
    const icon = container.querySelector(`[data-icon="${name}"]`) as HTMLElement;
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon.style.getPropertyValue('--accent')).toBe(featureIconGlow(name));
    expect(icon.querySelector('svg.lucide')).not.toBeNull();
  });

  it('makes every stroke drawable (unit path length, in order)', () => {
    const { container } = render(<FeatureIcon name="tasks" />);
    const shapes = [...container.querySelectorAll('svg.lucide > *')];
    expect(shapes.length).toBeGreaterThan(0);
    shapes.forEach((shape, index) => {
      expect(shape).toHaveAttribute('pathLength', '1');
      expect((shape as SVGElement).style.getPropertyValue('--i')).toBe(String(index));
    });
  });

  it('is complete at once where it cannot animate (no IntersectionObserver)', () => {
    const { container } = render(<FeatureIcon name="statistics" />);
    expect(container.querySelector('[data-icon]')).toHaveAttribute('data-reveal', 'off');
  });

  it('gives each icon its own gradient id, so two on one page never share one', () => {
    const { container } = render(
      <>
        <FeatureIcon name="tasks" />
        <FeatureIcon name="tasks" />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
  });
});
