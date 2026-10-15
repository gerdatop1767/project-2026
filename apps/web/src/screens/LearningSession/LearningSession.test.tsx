import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearningSession } from './LearningSession.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import {
  LearningSessionProvider,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getLearningSession: vi.fn(),
}));

const TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 5,
  topicId: null,
  topicName: null,
  difficulty: 2 as const,
  conditionMd: 'Условие',
  passage: null,
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerOptions: null,
  answerParts: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'task') {
    return <p data-testid="overlay">task:{overlay.taskId}</p>;
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function SessionMarker() {
  const { session } = useLearningSessionContext();
  return <p data-testid="session">{session ? `${session.status}:${session.sessionId}` : 'none'}</p>;
}

/** Mirrors AppDesktop/AppMobile: only mounts `LearningSession` while the
 * router's overlay is actually `learningSession` — so navigating away
 * (e.g. "Вернуться к тренировкам") unmounts it for real, the same as
 * in the real app, instead of leaving it running and re-fetching. */
function LearningSessionRoute() {
  const { overlay } = useNavigation();
  return overlay?.screen === 'learningSession' ? (
    <LearningSession key={overlay.sessionId} sessionId={overlay.sessionId} />
  ) : null;
}

function renderLearningSession(sessionId: string) {
  window.history.pushState(null, '', `/learning/session/${sessionId}`);
  return render(
    <NavigationProvider>
      <LearningSessionProvider>
        <LearningSessionRoute />
        <OverlayMarker />
        <SessionMarker />
      </LearningSessionProvider>
    </NavigationProvider>,
  );
}

describe('LearningSession — refresh/direct-link recovery (Phase 10)', () => {
  it('recovers the active task from the server (never a fake/cached one) and hands off into the existing task overlay', async () => {
    vi.mocked(api.getLearningSession).mockResolvedValue({
      sessionId: 'session-1',
      subject: 'math',
      status: 'active',
      position: 3,
      total: 10,
      task: TASK,
    });
    renderLearningSession('session-1');

    await waitFor(() => {
      expect(api.getLearningSession).toHaveBeenCalledWith('session-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task:task-1');
    });
    expect(screen.getByTestId('session')).toHaveTextContent('active:session-1');
  });

  it('shows an error (never a crash or a silently-new session) when the session no longer exists', async () => {
    vi.mocked(api.getLearningSession).mockResolvedValue(null);
    renderLearningSession('gone');

    expect(await screen.findByText(/больше не доступна/)).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).not.toHaveTextContent('task');
  });

  it('renders the real backend summary fields on a completed session, never invented stats', async () => {
    vi.mocked(api.getLearningSession).mockResolvedValue({
      sessionId: 'session-done',
      subject: 'math',
      status: 'completed',
      position: 10,
      total: 10,
      summary: {
        attempted: 10,
        correct: 7,
        incorrect: 3,
        accuracy: 70,
        skillsPracticed: 4,
        mistakesCreated: 3,
      },
    });
    renderLearningSession('session-done');

    expect(await screen.findByText('Тренировка завершена')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getAllByText('3')).toHaveLength(2); // incorrect + mistakesCreated
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Вернуться к тренировкам' }));
    // Navigates back to the Training tab — in the real app this unmounts
    // `LearningSession` (AppDesktop/AppMobile only render it for the
    // `learningSession` overlay), so there's no overlay left here either.
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('shows the Variant Completion heading and planned/solved count for a variant session, never the Smart Training heading', async () => {
    vi.mocked(api.getLearningSession).mockResolvedValue({
      sessionId: 'session-variant',
      subject: 'math',
      status: 'completed',
      position: 19,
      total: 19,
      summary: {
        attempted: 19,
        correct: 17,
        incorrect: 2,
        accuracy: 89,
        skillsPracticed: 5,
        mistakesCreated: 2,
      },
      variant: { variantId: 'v1', variantNumber: 1, variantTitle: 'Вариант 1' },
    });
    renderLearningSession('session-variant');

    expect(await screen.findByText('Вариант 1 завершён')).toBeInTheDocument();
    expect(screen.queryByText('Тренировка завершена')).not.toBeInTheDocument();
    expect(screen.getByText('19 / 19')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('89%')).toBeInTheDocument();
    // Variant completion shows only real attempt-based stats — never
    // the Smart Training-only "Навыков затронуто"/"Новых ошибок" rows.
    expect(screen.queryByText('Навыков затронуто')).not.toBeInTheDocument();
    expect(screen.queryByText('Новых ошибок')).not.toBeInTheDocument();
  });

  it('skips the extra fetch and redirects immediately when the context already holds this exact active session', async () => {
    // Mirrors the real flow: Training's "Умная тренировка" start already
    // primed the context (in an earlier commit, via an event handler,
    // the same way `applyLearningSessionResponse` does) before the
    // `LearningSession` route ever mounts — never simultaneously with it.
    function Primed({ ready }: { ready: boolean }) {
      const { setSession } = useLearningSessionContext();
      useEffect(() => {
        setSession({
          status: 'active',
          sessionId: 'primed-1',
          subjectId: 'math',
          currentTaskId: 'task-1',
          currentTaskNumber: 5,
          position: 1,
          total: 10,
        });
      }, [setSession]);
      return ready ? <LearningSession sessionId="primed-1" /> : null;
    }
    const { rerender } = render(
      <NavigationProvider>
        <LearningSessionProvider>
          <Primed ready={false} />
          <OverlayMarker />
        </LearningSessionProvider>
      </NavigationProvider>,
    );
    rerender(
      <NavigationProvider>
        <LearningSessionProvider>
          <Primed ready={true} />
          <OverlayMarker />
        </LearningSessionProvider>
      </NavigationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task:task-1');
    });
    expect(api.getLearningSession).not.toHaveBeenCalled();
  });
});
