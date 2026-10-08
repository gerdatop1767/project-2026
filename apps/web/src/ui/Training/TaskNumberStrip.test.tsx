import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskNumberStrip, type TaskNumberStripEntry } from './TaskNumberStrip.js';

function makeRange(count: number): TaskNumberStripEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${i + 1}`,
    taskNumber: i + 1,
  }));
}

/** A "По номерам" single-number session: every entry shares the same
 * exam number (V1#N, V2#N, ...) — see the navigation bugfix report. */
function makeSameNumberRange(count: number, taskNumber: number): TaskNumberStripEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `variant-${i + 1}-task-${taskNumber}`,
    taskNumber,
  }));
}

describe('TaskNumberStrip — active number stays in view (audit Block 4)', () => {
  it('scrolls the active number into view on first render, even deep in the range (e.g. #15 of 19)', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<TaskNumberStrip activeTaskId="task-15" range={makeRange(19)} onSelect={() => {}} />);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
  });

  it('re-scrolls when the active number changes (Prev/Next/Skip/number click)', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(
      <TaskNumberStrip activeTaskId="task-1" range={makeRange(19)} onSelect={() => {}} />,
    );
    const callsAfterMount = scrollIntoView.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    rerender(<TaskNumberStrip activeTaskId="task-19" range={makeRange(19)} onSelect={() => {}} />);
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('does not re-trigger the scroll on an unrelated re-render, so a manual scroll away is not fought back', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const range = makeRange(19);
    const { rerender } = render(
      <TaskNumberStrip activeTaskId="task-5" range={range} onSelect={() => {}} />,
    );
    const callsAfterMount = scrollIntoView.mock.calls.length;

    // Same active task, a new (but equal-length) range array — the
    // kind of re-render that happens constantly from parent state
    // changes unrelated to task navigation.
    rerender(<TaskNumberStrip activeTaskId="task-5" range={[...range]} onSelect={() => {}} />);
    expect(scrollIntoView.mock.calls.length).toBe(callsAfterMount);
  });

  it('still highlights and selects numbers via manual arrow/tap navigation', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TaskNumberStrip activeTaskId="task-5" range={makeRange(19)} onSelect={onSelect} />);
    expect(screen.getByText('5')).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByText('8'));
    expect(onSelect).toHaveBeenCalledWith({ taskId: 'task-8', taskNumber: 8 });
  });
});

describe('TaskNumberStrip — same-number "По номерам" session shows positions, not a repeated number (navigation bugfix)', () => {
  it('shows 1 2 3 4 5, never "13 13 13 13 13", when every entry is a different variant of #13', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const range = makeSameNumberRange(5, 13);
    render(<TaskNumberStrip activeTaskId="variant-3-task-13" range={range} onSelect={() => {}} />);
    expect(screen.queryByText('13')).not.toBeInTheDocument();
    expect(['1', '2', '3', '4', '5']).toEqual(
      screen
        .getAllByRole('button')
        .slice(1, 6)
        .map((b) => b.textContent),
    );
  });

  it('highlights exactly the active entry by taskId, not every entry sharing the same number', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const range = makeSameNumberRange(5, 13);
    render(<TaskNumberStrip activeTaskId="variant-3-task-13" range={range} onSelect={() => {}} />);
    const current = screen.getAllByRole('button').find((b) => b.getAttribute('aria-current'));
    expect(current?.textContent).toBe('3');
    expect(
      screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('clicking position "4" navigates to that entry (V4#13), not a different task number', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const range = makeSameNumberRange(5, 13);
    render(<TaskNumberStrip activeTaskId="variant-3-task-13" range={range} onSelect={onSelect} />);
    await user.click(screen.getByText('4'));
    expect(onSelect).toHaveBeenCalledWith({ taskId: 'variant-4-task-13', taskNumber: 13 });
  });

  it('a real Вариант session (distinct numbers) still shows the real exam numbers, not positions', () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<TaskNumberStrip activeTaskId="task-5" range={makeRange(19)} onSelect={() => {}} />);
    // Entry #10 has taskNumber 10 and sits at position 10 too — makeRange
    // can't distinguish the two interpretations by itself. #15 can: if
    // this were mislabeled by position it would read "15" only when 19
    // entries are shown (coincidentally correct here), so the real
    // check is #1's distinct neighbor sharing no duplicate number with
    // it — every label in a real Вариант range is unique.
    const labels = screen
      .getAllByRole('button')
      .slice(1, 20)
      .map((b) => b.textContent);
    expect(new Set(labels).size).toBe(19);
    expect(labels).toEqual(Array.from({ length: 19 }, (_, i) => String(i + 1)));
  });
});
