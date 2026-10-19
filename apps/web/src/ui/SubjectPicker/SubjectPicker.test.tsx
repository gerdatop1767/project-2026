import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectOptionList, SubjectSelect } from './SubjectPicker.js';
import { subjects } from '../../data/subjects.js';
import { subjectIconSrc, type SubjectIconId } from '../SubjectIcon/subjectIcons.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getTaskCountsBySubject: vi.fn(() =>
    Promise.resolve({
      items: [
        { subjectId: 'math', count: 67 },
        { subjectId: 'russian', count: 1 },
      ],
    }),
  ),
}));

describe('SubjectOptionList', () => {
  it('shows every subject with its own existing artwork, in the usual order', () => {
    render(<SubjectOptionList aria-label="Предмет" value="math" onSelect={() => {}} />);
    const cards = screen.getAllByRole('radio');
    expect(cards.map((card) => card.textContent)).toEqual(
      subjects.map((s) => expect.stringContaining(s.name) as unknown as string),
    );
    subjects.forEach((subject, index) => {
      expect(cards[index]!.querySelector('img')).toHaveAttribute(
        'src',
        subjectIconSrc(subject.id as SubjectIconId),
      );
    });
  });

  it('marks the chosen subject, and the caption is the real published-task count', async () => {
    render(<SubjectOptionList aria-label="Предмет" value="math" onSelect={() => {}} />);
    const math = screen.getByRole('radio', { name: /Математика/ });
    expect(math).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Русский язык/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(await within(math).findByText('67 заданий')).toBeInTheDocument();
    expect(await screen.findByText('1 задание')).toBeInTheDocument();
    expect(api.getTaskCountsBySubject).toHaveBeenCalled();
  });

  it('reports the pick at once — the caller decides, nothing waits', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SubjectOptionList aria-label="Предмет" value="math" onSelect={onSelect} />);
    await user.click(screen.getByRole('radio', { name: /Физика/ }));
    expect(onSelect).toHaveBeenCalledWith('physics');
  });

  it('multi-select variant uses checkboxes', () => {
    render(
      <SubjectOptionList
        multiple
        aria-label="Предметы"
        value={['math', 'russian']}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getAllByRole('checkbox').filter((c) => c.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(2);
  });
});

describe('SubjectSelect', () => {
  it('opens the shared list and selects + closes on a pick; keyboard works', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SubjectSelect label="Предмет" value="math" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Математика/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: /Химия/ }));
    expect(onChange).toHaveBeenCalledWith('chemistry');
  });
});
