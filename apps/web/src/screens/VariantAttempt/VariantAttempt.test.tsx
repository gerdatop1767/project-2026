import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';
import { ApiError } from '../../lib/api.js';
import { VariantHistoryCard } from '../../ui/Statistics/VariantHistoryCard.js';
import { VariantAttempt } from './VariantAttempt.js';
import { attemptDetail, attemptScoring } from './fixtures.js';

vi.mock('../../lib/api.js', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof api>()).ApiError,
  getVariantAttempt: vi.fn(),
}));

function Where() {
  const { overlay } = useNavigation();
  return (
    <p data-testid="where">
      {overlay
        ? `${overlay.screen}:${'taskId' in overlay ? overlay.taskId : 'sessionId' in overlay ? overlay.sessionId : ''}`
        : 'none'}
    </p>
  );
}

const renderAttempt = (sessionId = '11111111-1111-4111-8111-111111111111') =>
  render(
    <NavigationProvider>
      <VariantAttempt sessionId={sessionId} />
      <Where />
    </NavigationProvider>,
  );

describe('VariantAttempt — one attempt’s full result', () => {
  it('shows the score, every task with answers, results by number and topic', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(attemptDetail());
    renderAttempt();
    expect(await screen.findByRole('heading', { name: 'Вариант 1' })).toBeInTheDocument();
    expect(screen.getByText('из 4 верно')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    const score = screen.getByText('из 4 верно').closest('div')!;
    expect(within(score).getByText('Пропущено')).toBeInTheDocument();
    expect(within(score).getByText('Время')).toBeInTheDocument();
    const tasks = screen.getByRole('heading', { name: 'Задания и ответы' }).closest('section')!;
    expect(within(tasks).getAllByRole('listitem')).toHaveLength(4);
    const numbers = screen.getByRole('heading', { name: 'По номерам заданий' }).closest('section')!;
    expect(within(numbers).getAllByRole('listitem')).toHaveLength(4);
    const topics = screen.getByRole('heading', { name: 'По темам' }).closest('section')!;
    expect(within(topics).getByText('1/2')).toBeInTheDocument();
  });

  it('a task opens to the user’s answer, the right one and the explanation', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(attemptDetail());
    const user = userEvent.setup();
    renderAttempt();
    const row = await screen.findByRole('button', { name: /№3.*Неверно.*попыток: 2/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(row.getAttribute('aria-controls')!)!;
    expect(within(body).getByText('7')).toBeInTheDocument();
    expect(within(body).getByText('Разбор задания 3')).toBeInTheDocument();
    await user.click(within(body).getByRole('button', { name: 'Открыть задание' }));
    expect(screen.getByTestId('where')).toHaveTextContent('task:task-3');
  });

  it('«Стоит повторить» lists the wrong and skipped tasks and opens them', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(attemptDetail());
    const user = userEvent.setup();
    renderAttempt();
    const repeat = (await screen.findByRole('heading', { name: 'Стоит повторить' })).closest(
      'section',
    )!;
    const chips = within(repeat).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['№3Логарифмы', '№4']);
    await user.click(chips[1]!);
    expect(screen.getByTestId('where')).toHaveTextContent('task:task-4');
  });

  it('an unfinished attempt can be continued; an older one says how it was counted', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(
      attemptDetail({ status: 'active', completedAt: null, attribution: 'time_window' }),
    );
    const user = userEvent.setup();
    renderAttempt();
    expect(await screen.findByText(/не завершён/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('старой версии');
    await user.click(screen.getByRole('button', { name: 'Продолжить вариант' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      'learningSession:11111111-1111-4111-8111-111111111111',
    );
  });

  it('someone else’s or a missing attempt is simply «not found»', async () => {
    vi.mocked(api.getVariantAttempt).mockRejectedValue(new ApiError(404, undefined));
    renderAttempt();
    expect(await screen.findByRole('alert')).toHaveTextContent('Эта попытка не найдена.');
  });

  it('Statistics: each history card opens THAT attempt', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        {['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'].map(
          (id, i) => (
            <VariantHistoryCard
              key={id}
              item={{
                sessionId: id,
                variantId: 'v1',
                variantNumber: 1,
                variantTitle: 'Вариант 1',
                subjectId: 'math',
                status: i === 0 ? 'completed' : 'active',
                startedAt: `2026-10-2${i + 1}T10:00:00.000Z`,
                completedAt: null,
                plannedCount: 19,
                solvedCount: 3,
                correctCount: 2,
                incorrectCount: 1,
                accuracyPercent: 67,
                totalTimeMs: null,
                keyErrors: [],
              }}
            />
          ),
        )}
        <Where />
      </NavigationProvider>,
    );
    const cards = screen.getAllByRole('button', { name: /Вариант 1, попытка от/ });
    expect(cards).toHaveLength(2);
    await user.click(cards[1]!);
    expect(screen.getByTestId('where')).toHaveTextContent(
      'variantAttempt:aaaaaaaa-0000-4000-8000-000000000002',
    );
  });
});

describe('VariantAttempt — «Баллы ЕГЭ»', () => {
  it('shows primary points, the part split and the per-task breakdown; no test score without a scale', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(
      attemptDetail({ scoring: attemptScoring() }),
    );
    renderAttempt();
    const card = (await screen.findByRole('heading', { name: 'Баллы ЕГЭ' })).closest(
      'div',
    )!.parentElement!;
    expect(within(card).getByText('9')).toBeInTheDocument();
    expect(within(card).getByText('из 33')).toBeInTheDocument();
    expect(within(card).getByText('1 / 13')).toBeInTheDocument();
    expect(within(card).getByText('8 / 18')).toBeInTheDocument();
    expect(
      within(card).getByText(/шкала перевода ЕГЭ-2027 ещё не опубликована/),
    ).toBeInTheDocument();
    expect(within(card).getByText(/№17 сейчас на проверке/)).toBeInTheDocument();
    expect(within(card).getByText(/Часть 2 оценена только по ответу/)).toBeInTheDocument();
    expect(within(card).getByText(/по проекту КИМ ЕГЭ 2027/)).toBeInTheDocument();
    expect(within(card).queryByText('Предварительно')).not.toBeInTheDocument();
    const table = within(card).getByRole('table', { name: 'Баллы по заданиям' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(within(rows[4]!).getByText('Частично')).toBeInTheDocument();
    expect(within(rows[4]!).getByText('2 из 4')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Нет ответа')).toBeInTheDocument();
  });

  it('marks an unfinished attempt as preliminary', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(
      attemptDetail({ status: 'active', scoring: attemptScoring({ preliminary: true }) }),
    );
    renderAttempt();
    expect(await screen.findByText('Предварительно')).toBeInTheDocument();
    expect(screen.getByText('Вариант не завершён — баллы могут измениться.')).toBeInTheDocument();
  });

  it('shows a confirmed approximate scale as an estimate, with its source', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(
      attemptDetail({
        scoring: attemptScoring({
          conversion: {
            available: true,
            testScore: 50,
            scaleId: 's',
            status: 'approximate',
            source: 'тестовая шкала',
            updatedAt: '2027-07-01',
          },
        }),
      }),
    );
    renderAttempt();
    expect(await screen.findByText('≈ 50')).toBeInTheDocument();
    expect(
      screen.getByText(/Оценка приблизительная, официальная шкала может отличаться/),
    ).toBeInTheDocument();
  });

  it('«Разобрать ошибки» opens the first wrong task’s explanation in place', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getVariantAttempt).mockResolvedValue(
      attemptDetail({ scoring: attemptScoring() }),
    );
    renderAttempt();
    await user.click(await screen.findByRole('button', { name: /Разобрать ошибки/ }));
    const tasks = screen.getByRole('heading', { name: 'Задания и ответы' }).closest('section')!;
    expect(within(tasks).getByRole('button', { name: /№3/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(tasks).getByRole('button', { name: /№4/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shows no points block for a source without exam rules', async () => {
    vi.mocked(api.getVariantAttempt).mockResolvedValue(attemptDetail());
    renderAttempt();
    await screen.findByRole('heading', { name: 'Вариант 1' });
    expect(screen.queryByRole('heading', { name: 'Баллы ЕГЭ' })).not.toBeInTheDocument();
  });
});
