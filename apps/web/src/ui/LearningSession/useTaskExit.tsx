import { useState, type ReactNode } from 'react';
import { finishLearningSession } from '../../lib/api.js';
import {
  applyLearningSessionResponse,
  useActiveLearningSessionForTask,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { Button } from '../Button/Button.js';

/** Where leaving a training / variant lands. */
const EXIT_ROUTE: Route = { screen: 'training' };

/**
 * The back arrow of Task/Result. Normally it returns to `returnTo` (or
 * the previous screen). Inside a learning session `returnTo` is the
 * session's own page, which — while the session is active — opens its
 * current task again: going «back» there was a loop and the student
 * could not leave a variant. So inside a session the arrow asks first
 * and then leaves to Training. Nothing is lost by leaving: every checked
 * answer is already on the server, the session stays active and a
 * variant can be continued from «Статистика вариантов». «Завершить
 * вариант» finishes it now instead.
 */
export function useTaskExit(
  taskId: string,
  returnTo: Route | undefined,
): { goBack: () => void; exitSheet: ReactNode } {
  const { navigate, back } = useNavigation();
  const session = useActiveLearningSessionForTask(taskId);
  const { setSession, clearSession } = useLearningSessionContext();
  const [open, setOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState(false);

  const intoSession = returnTo?.screen === 'learningSession';

  function leave() {
    setOpen(false);
    clearSession();
    // Replaces the session's history entry: Back after leaving must not
    // drop the student into the task again.
    navigate(EXIT_ROUTE, { replace: true });
  }

  const goBack = intoSession
    ? () => (session ? setOpen(true) : leave())
    : returnTo
      ? () => navigate(returnTo, { replace: true })
      : back;

  function finish() {
    if (!session) return;
    setFinishing(true);
    setError(false);
    finishLearningSession(session.sessionId)
      .then((response) => {
        setOpen(false);
        if (applyLearningSessionResponse(response, setSession, navigate) === 'none') leave();
      })
      .catch(() => setError(true))
      .finally(() => setFinishing(false));
  }

  const isVariant = Boolean(session?.variant);
  const exitSheet = session ? (
    <BottomSheet
      open={open}
      onClose={() => setOpen(false)}
      title={isVariant ? 'Выйти из варианта?' : 'Выйти из тренировки?'}
    >
      <p className="text-body-sm">
        {isVariant
          ? 'Проверенные ответы сохранены. Вернуться к варианту можно в «Статистике вариантов» — кнопка «Продолжить вариант». Нерешённые задания засчитаются, только когда ты их решишь.'
          : 'Проверенные ответы уже сохранены в статистике.'}
      </p>
      {error && (
        <p className="text-body-sm" role="alert" style={{ color: 'var(--color-error)' }}>
          Не удалось завершить вариант — проверь соединение и попробуй ещё раз.
        </p>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>
          Остаться
        </Button>
        <Button variant="primary" fullWidth onClick={leave} disabled={finishing}>
          Выйти
        </Button>
        {isVariant && (
          <Button variant="ghost" fullWidth loading={finishing} onClick={finish}>
            Завершить вариант и посмотреть результат
          </Button>
        )}
      </div>
    </BottomSheet>
  ) : null;

  return { goBack, exitSheet };
}
