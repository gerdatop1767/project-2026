import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';
import { RevealAnswer } from './RevealAnswer.js';

vi.mock('../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  revealAnswer: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe('«Показать ответ»', () => {
  it('asks first (50% of XP), and only «Показать ответ» asks the server', async () => {
    const user = userEvent.setup();
    vi.mocked(api.revealAnswer).mockResolvedValue({
      correctAnswer: '42',
      correctAnswerDisplay: null,
      explanationMd: 'Потому что так.',
      answerType: 'short_answer',
    } as Awaited<ReturnType<typeof api.revealAnswer>>);
    render(<RevealAnswer taskId="t1" />);

    await user.click(screen.getByRole('button', { name: /Показать ответ/ }));
    expect(screen.getByText(/50% опыта/)).toBeInTheDocument();
    expect(api.revealAnswer).not.toHaveBeenCalled();

    // «Решу сам» closes it without a request.
    await user.click(screen.getByRole('button', { name: 'Решу сам' }));
    expect(api.revealAnswer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Показать ответ/ }));
    const confirm = screen.getAllByRole('button', { name: 'Показать ответ' }).at(-1)!;
    await user.click(confirm);
    expect(api.revealAnswer).toHaveBeenCalledWith('t1');
    expect(await screen.findByText('Потому что так.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ответ и решение' })).toHaveTextContent('42');
  });

  it('a failed request says so and lets the student try again', async () => {
    const user = userEvent.setup();
    vi.mocked(api.revealAnswer).mockRejectedValue(new Error('offline'));
    render(<RevealAnswer taskId="t2" />);
    await user.click(screen.getByRole('button', { name: /Показать ответ/ }));
    await user.click(screen.getAllByRole('button', { name: 'Показать ответ' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить ответ');
  });
});
