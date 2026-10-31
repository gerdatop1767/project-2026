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

  it('is not offered for a subject without a theory catalog', () => {
    render(<TaskLike subjectId="math" taskNumber={4} />);
    expect(screen.queryByRole('button', { name: 'Правило' })).not.toBeInTheDocument();
  });
});
