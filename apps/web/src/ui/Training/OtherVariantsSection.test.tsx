import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtherVariantsSection } from './OtherVariantsSection.js';
import type { TaskVariant } from '../../data/sampleTask.js';

const VARIANTS: TaskVariant[] = [
  { id: 'task-a', code: '#1e150aa2', difficultyLabel: 'Сложное', preview: 'log₅(x − 1) ≤ 2' },
  { id: 'task-b', code: '#d1033404', difficultyLabel: 'Среднее', preview: '$8^{1-4x} = 0$' },
];

describe('OtherVariantsSection (mobile) — "Другие задания", real math, correct click target', () => {
  it('is collapsed by default and expands via the summary toggle', () => {
    render(
      <OtherVariantsSection
        taskNumber={13}
        variants={VARIANTS}
        open={false}
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        summarySubtitle="Похожее на это задание"
      />,
    );
    expect(screen.getByRole('button', { name: /Другие задания №13/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders every variant card with the shared VariantPreviewCard (same card as desktop)', () => {
    render(
      <OtherVariantsSection
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        summarySubtitle="Похожее на это задание"
      />,
    );
    expect(screen.getByText('#1e150aa2')).toBeInTheDocument();
    expect(screen.getByText('#d1033404')).toBeInTheDocument();
  });

  it('never shows the raw $...$ LaTeX source — renders real KaTeX instead (bugfix)', () => {
    render(
      <OtherVariantsSection
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        summarySubtitle="Похожее на это задание"
      />,
    );
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml).toBeInTheDocument();
    expect(katexHtml!.textContent).not.toContain('$');
  });

  it('clicking a card calls onSelectVariant with that exact variant', async () => {
    const user = userEvent.setup();
    const onSelectVariant = vi.fn();
    render(
      <OtherVariantsSection
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={onSelectVariant}
        onGoToList={() => {}}
        summarySubtitle="Похожее на это задание"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Задание #d1033404/ }));
    expect(onSelectVariant).toHaveBeenCalledWith(VARIANTS[1]);
    expect(onSelectVariant).toHaveBeenCalledTimes(1);
  });

  /**
   * "К списку заданий №N" (UX bugfix round 3 — this button was briefly
   * removed as inert, now restored as a real action): takes the user
   * to Тренировка → По номерам with this taskNumber pre-selected,
   * never auto-starting training — see `onGoToList`'s doc comment.
   */
  it('renders a "К списку заданий №13" button and clicking it calls onGoToList', async () => {
    const user = userEvent.setup();
    const onGoToList = vi.fn();
    render(
      <OtherVariantsSection
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={onGoToList}
        summarySubtitle="Похожее на это задание"
      />,
    );
    const button = screen.getByRole('button', { name: /К списку заданий №13/ });
    await user.click(button);
    expect(onGoToList).toHaveBeenCalledTimes(1);
  });
});
