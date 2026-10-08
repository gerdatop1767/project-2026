import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VariantPreviewCard } from './VariantPreviewCard.js';
import type { TaskVariant } from '../../data/sampleTask.js';

const VARIANT: TaskVariant = {
  id: 'task-1e150aa2',
  code: '#1e150aa2',
  difficultyLabel: 'Сложное',
  preview: 'а) Решите уравнение $\\sqrt{4\\sin^3x - 4\\cos^2x} - \\cos x = 0$',
};

describe('VariantPreviewCard — renders real math, never raw LaTeX (Similar Tasks bugfix)', () => {
  it('renders the $...$ span through KaTeX, not as visible plain text', () => {
    render(<VariantPreviewCard variant={VARIANT} onSelect={() => {}} />);
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml).toBeInTheDocument();
    expect(katexHtml!.textContent).not.toMatch(/\\sqrt/);
    expect(katexHtml!.textContent).not.toContain('$');
  });

  it('shows the code and difficulty badge', () => {
    render(<VariantPreviewCard variant={VARIANT} onSelect={() => {}} />);
    expect(screen.getByText('#1e150aa2')).toBeInTheDocument();
    expect(screen.getByText('Сложное')).toBeInTheDocument();
  });

  it('calls onSelect with the exact variant when clicked, never a different one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<VariantPreviewCard variant={VARIANT} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /Задание #1e150aa2/ }));
    expect(onSelect).toHaveBeenCalledWith(VARIANT);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a plain-text (no LaTeX) preview still renders correctly, never broken by the math tokenizer', () => {
    render(
      <VariantPreviewCard
        variant={{ ...VARIANT, preview: 'Обычный текст без формул.' }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Обычный текст без формул.')).toBeInTheDocument();
    expect(document.querySelector('.katex')).not.toBeInTheDocument();
  });
});
