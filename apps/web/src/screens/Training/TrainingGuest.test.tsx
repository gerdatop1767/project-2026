import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Training } from './Training.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TestAuthProvider } from '../../lib/authTestUtils.js';
import { AccountGateProvider } from '../../lib/accountGate.js';
import { LearningSessionProvider } from '../../lib/learningSessionContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  listCollections: vi.fn(),
  getRandomTask: vi.fn(),
  getProgressByTopic: vi.fn(),
  getTopics: vi.fn(),
  getVariant: vi.fn(),
  startLearningSession: vi.fn(),
  startVariantSession: vi.fn(),
  listTasksByNumber: vi.fn(),
  ApiError: class extends Error {},
}));

const COLLECTION = {
  collection: {
    id: 'c1',
    subjectId: 'math',
    slug: 'ege-2026',
    title: 'ЕГЭ 2026',
    publisher: 'Ященко',
    year: 2026,
    description: null,
  },
  variants: [{ id: 'v1', collectionId: 'c1', variantNumber: 1, title: 'Вариант 1', year: 2026 }],
};

function TaskProbe() {
  const { overlay } = useNavigation();
  if (overlay?.screen !== 'task') return null;
  return (
    <p data-testid="task">
      {overlay.taskId}|{overlay.variantId}|{(overlay.customOrderedTasks ?? []).length}
    </p>
  );
}

function renderAsGuest() {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={null}>
        <LearningSessionProvider>
          <AccountGateProvider>
            <Training />
            <TaskProbe />
          </AccountGateProvider>
        </LearningSessionProvider>
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
  vi.mocked(api.getTopics).mockResolvedValue({
    items: [{ topicId: 't1', topicName: 'Логарифмы', completed: 0, total: 4 }],
  });
});

describe('Тренировка for a guest (no account)', () => {
  it('topics come from the PUBLIC topic list — never the personal progress endpoint', async () => {
    renderAsGuest();
    expect(await screen.findByRole('button', { name: /Логарифмы/ })).toBeInTheDocument();
    expect(api.getTopics).toHaveBeenCalledWith({ subject: 'math', collection: undefined });
    expect(api.getProgressByTopic).not.toHaveBeenCalled();
  });

  it('«Мои ошибки» and «Умная тренировка» are locked: the window explains, the mode does not change', async () => {
    const user = userEvent.setup();
    renderAsGuest();
    await user.click(screen.getByRole('button', { name: /Мои ошибки/ }));
    expect(
      await screen.findByRole('dialog', { name: 'Мои ошибки — после входа' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Не сейчас' }));
    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    expect(
      await screen.findByRole('dialog', { name: 'Умная тренировка — после входа' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /По теме/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('«Только нерешённые» needs an account: the window opens, the toggle stays off', async () => {
    const user = userEvent.setup();
    renderAsGuest();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const unseen = await screen.findByRole('button', { name: 'Только нерешённые' });
    await user.click(unseen);
    expect(
      await screen.findByRole('dialog', { name: '«Только нерешённые» — после входа' }),
    ).toBeInTheDocument();
    expect(unseen).toHaveAttribute('aria-pressed', 'false');
  });

  it('a variant opens for a guest as its own ordered tasks — no account-only session needed', async () => {
    vi.mocked(api.getVariant).mockResolvedValue({
      variant: COLLECTION.variants[0]!,
      collection: COLLECTION.collection,
      tasks: [1, 2, 3].map((n) => ({
        position: n,
        task: { id: `task-${n}`, subjectId: 'math', taskNumber: n } as never,
      })),
    } as never);
    const user = userEvent.setup();
    renderAsGuest();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    await user.click(await screen.findByRole('button', { name: /Все источники/ }));
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026' }));
    await user.click(await screen.findByRole('button', { name: 'Вариант 1' }));
    await user.click(screen.getByRole('button', { name: /Начать тренировку/ }));
    await waitFor(() => expect(screen.getByTestId('task')).toHaveTextContent('task-1|v1|3'));
    expect(api.startVariantSession).not.toHaveBeenCalled();
  });
});
