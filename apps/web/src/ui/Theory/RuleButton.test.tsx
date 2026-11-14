import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleButton } from './RuleButton.js';

function TaskLike({ subjectId, taskNumber }: { subjectId: string; taskNumber: number }) {
  const [answer, setAnswer] = useState('');
  return (
    <div>
      <input aria-label="Ответ" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <RuleButton subjectId={subjectId} taskNumber={taskNumber} presentation="sheet" />
    </div>
  );
}

describe('«Правило» on the task screen', () => {
  it('opens the rule for this task number and keeps the typed answer', async () => {
    const user = userEvent.setup();
    render(<TaskLike subjectId="russian" taskNumber={4} />);
    await user.type(screen.getByLabelText('Ответ'), '135');
    await user.click(screen.getByRole('button', { name: 'Правило' }));
    const dialog = await screen.findByRole('dialog', { name: 'Правило к заданию №4' });
    expect(dialog).toHaveTextContent('Орфоэпические нормы');
    expect(await screen.findByText(/Как решать/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Ответ')).toHaveValue('135');
  });

  it('says honestly when a task has no material yet', async () => {
    const user = userEvent.setup();
    render(<TaskLike subjectId="russian" taskNumber={1} />);
    await user.click(screen.getByRole('button', { name: 'Правило' }));
    expect(await screen.findByText('Материала к заданию №1 пока нет')).toBeInTheDocument();
  });

  it('math: every number of part 2 offers its theory (№18 — parameters)', () => {
    render(<TaskLike subjectId="math" taskNumber={18} />);
    expect(screen.getByRole('button', { name: 'Теория' })).toBeInTheDocument();
  });

  it('math: not offered for a number the edition does not have', () => {
    render(<TaskLike subjectId="math" taskNumber={25} />);
    expect(screen.queryByRole('button', { name: /Правило|Теория/ })).not.toBeInTheDocument();
  });
});

describe('«Теория» on a math task follows the task edition', () => {
  it('opens the topic of this edition: ЕГЭ-2027 №16 and old Ященко №13 → finance; old №6 → random variables', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <RuleButton subjectId="math" taskNumber={16} edition="ege-2027" presentation="modal" />,
    );
    await user.click(screen.getByRole('button', { name: 'Теория' }));
    expect(await screen.findByRole('dialog', { name: 'Теория к заданию №16' })).toHaveTextContent(
      'ЕГЭ-2027 · Финансовая математика',
    );
    unmount();
    const second = render(
      <RuleButton
        subjectId="math"
        taskNumber={13}
        edition="ege-2027-project"
        presentation="modal"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Теория' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('старая редакция');
    second.unmount();
    render(
      <RuleButton
        subjectId="math"
        taskNumber={6}
        edition="ege-2027-project"
        presentation="modal"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Теория' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Случайные величины');
  });

  it('ЕГЭ-2027 №6 opens equations — not the old №6 — and a number beyond the edition shows nothing', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <RuleButton subjectId="math" taskNumber={6} edition="ege-2027" presentation="modal" />,
    );
    await user.click(screen.getByRole('button', { name: 'Теория' }));
    const dialog = await screen.findByRole('dialog', { name: 'Теория к заданию №6' });
    expect(dialog).toHaveTextContent('ЕГЭ-2027 · Простейшие уравнения');
    expect(dialog).not.toHaveTextContent('Случайные величины');
    unmount();
    render(<RuleButton subjectId="math" taskNumber={20} edition="ege-2027" presentation="modal" />);
    expect(screen.queryByRole('button', { name: 'Теория' })).not.toBeInTheDocument();
  });
});
