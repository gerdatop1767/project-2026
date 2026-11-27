import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ApiModule from '../../lib/api.js';
import { subjects } from '../../data/subjects.js';
import { TaskChrome } from './TaskChrome.js';

vi.mock('../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  listFavoriteTaskIds: vi.fn().mockResolvedValue([]),
}));

afterEach(() => vi.clearAllMocks());

const range = Array.from({ length: 120 }, (_, i) => ({ taskId: `t${i + 1}`, taskNumber: 9 }));

function renderChrome(onSelectNumber = vi.fn(), r = range) {
  render(
    <TaskChrome
      subject={subjects[0]!}
      taskId="t5"
      taskNumber={9}
      onBack={vi.fn()}
      numberStripRange={r}
      onSelectNumber={onSelectNumber}
      previous={r[3] ?? null}
      next={r[5] ?? null}
      onGoTo={vi.fn()}
      indexInSession={r.length >= 5 ? 5 : 1}
      totalInSession={r.length}
      marks={{ t2: 'correct', t3: 'incorrect' }}
    />,
  );
  return onSelectNumber;
}

describe('TaskChrome — every number one tap away on a phone', () => {
  it('«Задание N из M» opens all numbers in a sheet; a tap opens that task', async () => {
    const user = userEvent.setup();
    const onSelectNumber = renderChrome();
    await user.click(screen.getByRole('button', { name: /Задание 5 из 120/ }));

    const sheet = screen.getByRole('dialog', { name: 'Все задания' });
    const grid = within(sheet).getByRole('navigation', { name: 'Все задания' });
    expect(within(grid).getAllByRole('button')).toHaveLength(120);
    expect(within(grid).getByRole('button', { name: 'Задание 5' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(within(grid).getByRole('button', { name: 'Задание 2 — верно' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: 'Задание 3 — неверно' })).toBeInTheDocument();

    await user.click(within(grid).getByRole('button', { name: 'Задание 97' }));
    expect(onSelectNumber).toHaveBeenCalledWith({ taskId: 't97', taskNumber: 9 });
  });

  it('a single task has nothing to pick — plain text, no sheet', () => {
    renderChrome(vi.fn(), [{ taskId: 't5', taskNumber: 9 }]);
    expect(screen.queryByRole('button', { name: /Задание 1 из 1/ })).not.toBeInTheDocument();
    expect(screen.getByText('Задание 1 из 1')).toBeInTheDocument();
  });
});
