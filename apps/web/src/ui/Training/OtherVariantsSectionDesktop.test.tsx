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
 * Desktop "Другие задания" (UX bugfix round 2): collapsed-by-default
 * accordion, matching mobile's `OtherVariantsSection` exactly, never
 * an always-expanded block — same cards (`VariantPreviewCard`), same
 * math renderer, same click behavior/data source as mobile, only the
 * expanded layout (grid vs stacked column) differs.
 */
describe('OtherVariantsSectionDesktop — collapsible accordion, same UX as mobile', () => {
  it('is collapsed by default', () => {
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open={false}
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        subtitle="Похожие задания на эту тему"
      />,
    );
    expect(screen.getByRole('button', { name: /Другие задания №13/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('clicking the header calls onToggle (expand)', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open={false}
        onToggle={onToggle}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        subtitle="Похожие"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Другие задания №13/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking the header again calls onToggle (collapse)', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={onToggle}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(screen.getByRole('button', { name: /Другие задания №13/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /Другие задания №13/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders one card per variant (using the shared VariantPreviewCard) when open', () => {
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
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
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * "К списку заданий №N" (UX bugfix round 3 — this button was briefly
   * removed as inert, now restored as a real action): takes the user
   * to Тренировка → По номерам with this taskNumber pre-selected,
   * never auto-starting training — see `onGoToList`'s doc comment on
   * `OtherVariantsSection`.
   */
  it('renders a "К списку заданий №13" button and clicking it calls onGoToList', async () => {
    const user = userEvent.setup();
    const onGoToList = vi.fn();
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={onGoToList}
        subtitle="Похожие"
      />,
    );
    const button = screen.getByRole('button', { name: /К списку заданий №13/ });
    await user.click(button);
    expect(onGoToList).toHaveBeenCalledTimes(1);
  });

  it('clicking a card calls onSelectVariant with that exact variant, never a different one or the current one', async () => {
    const user = userEvent.setup();
    const onSelectVariant = vi.fn();
    render(
      <OtherVariantsSectionDesktop
        taskNumber={13}
        variants={VARIANTS}
        open
        onToggle={() => {}}
        onSelectVariant={onSelectVariant}
        onGoToList={() => {}}
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
        open
        onToggle={() => {}}
        onSelectVariant={() => {}}
        onGoToList={() => {}}
        subtitle="Похожие"
      />,
    );
    expect(document.querySelector('.katex')).toBeInTheDocument();
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml!.textContent).not.toContain('$');
  });
});
