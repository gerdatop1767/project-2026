import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtherVariantsSectionDesktop } from './OtherVariantsSectionDesktop.js';
import type { TaskVariant } from '../../data/sampleTask.js';

const VARIANTS: TaskVariant[] = [
  { id: 'task-a', code: '#1e150aa2', difficultyLabel: 'Сложное', preview: 'log₅(x − 1) ≤ 2' },
  { id: 'task-b', code: '#d1033404', difficultyLabel: 'Среднее', preview: '$8^{1-4x} = 0$' },
];

/**
 * Desktop "Другие задания" block (bugfix: desktop had no equivalent of
 * mobile's "Другие задания" at all) — same cards/math renderer/click
 * behavior/data source as mobile's OtherVariantsSection, just an
 * always-visible grid instead of a collapsible accordion.
 */
describe('OtherVariantsSectionDesktop', () => {
  it('renders the header with the real taskNumber and subtitle', () => {
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        onSelectVariant={() => {}}
        subtitle="Похожие задания на эту тему"
      />,
    );
    expect(screen.getByText('Другие задания №13')).toBeInTheDocument();
    expect(screen.getByText('Похожие задания на эту тему')).toBeInTheDocument();
  });

  it('renders one card per variant, using the shared VariantPreviewCard (same card as mobile)', () => {
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        onSelectVariant={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(screen.getByText('#1e150aa2')).toBeInTheDocument();
    expect(screen.getByText('#d1033404')).toBeInTheDocument();
  });

  it('renders nothing when there are no variants, rather than an empty block', () => {
    const { container } = render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={[]}
        onSelectVariant={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('clicking a card calls onSelectVariant with that exact variant, never a different one or the current one', async () => {
    const user = userEvent.setup();
    const onSelectVariant = vi.fn();
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        onSelectVariant={onSelectVariant}
        subtitle="Похожие"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Задание #d1033404/ }));
    expect(onSelectVariant).toHaveBeenCalledWith(VARIANTS[1]);
    expect(onSelectVariant).toHaveBeenCalledTimes(1);
  });

  it('never shows the raw $...$ LaTeX source for a card with real math', () => {
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        onSelectVariant={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(document.querySelector('.katex')).toBeInTheDocument();
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml!.textContent).not.toContain('$');
  });
});
