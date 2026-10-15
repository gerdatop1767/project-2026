import { useEffect, useState } from 'react';
import { trainingByNumberRouteFor, useNavigation, type Route } from '../../lib/navigation.js';
import { serializeMultiPartUserAnswer } from '@zybrilka/shared';
import { getTask, listTasksByNumber, submitAttempt } from '../../lib/api.js';
import { buildSessionProgress, toSampleTask } from '../../lib/taskAdapter.js';
import { useFavorite } from '../../lib/useFavorite.js';
import { useTaskNavigation } from '../../lib/useTaskNavigation.js';
import { useActiveLearningSessionForTask } from '../../lib/learningSessionContext.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { useSolvingTimer } from '../../lib/useSolvingTimer.js';
import { SolvingTimer } from '../../ui/Timer/SolvingTimer.js';
import { LearningSessionBadge } from '../../ui/LearningSession/LearningSessionBadge.js';
import type { TaskVariant } from '../../data/sampleTask.js';
import { subjects } from '../../data/subjects.js';
import { Button } from '../../ui/Button/Button.js';
import { Calculator } from '../../ui/Calculator/Calculator.js';
import { CanvasWorkspaceDesktop } from '../../ui/CanvasWorkspace/CanvasWorkspaceDesktop.js';
import { clearCanvasState } from '../../lib/canvasSessionStore.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Modal } from '../../ui/Modal/Modal.js';
import { ReportTaskContent } from '../../ui/ReportTask/ReportTaskContent.js';
import { DesktopToolsCard } from '../../ui/Training/DesktopToolsCard.js';
import { OtherVariantsSectionDesktop } from '../../ui/Training/OtherVariantsSectionDesktop.js';
import { SessionProgressCard } from '../../ui/Training/SessionProgressCard.js';
import { SessionTaskListCard } from '../../ui/Training/SessionTaskListCard.js';
import { ProgressBar } from '../../ui/Progress/ProgressBar.js';
import { Collapse, FadeIn } from '../../ui/motion/motion.js';
import { MathText } from '../../ui/MathText/MathText.js';
import { MathAnswerField } from '../../ui/MathAnswerField/MathAnswerField.js';
import { TaskExamIllustration } from '../../ui/TaskIllustration/TaskIllustration.js';
import { PassageCard } from '../../ui/Passage/PassageCard.js';
import { EssayPanel } from '../../ui/Essay/EssayPanel.js';
import { useEssayAck } from '../../lib/useEssayAck.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TaskDesktop.module.css';

export interface TaskDesktopProps {
  subjectId: string;
  taskNumber: number;
  taskId: string;
  collectionSlug?: string;
  variantId?: string;
  /** A user-assembled task list (see navigation.tsx's `task.customOrderedTasks`) — takes over the number strip / prev-next ordering when present. */
  customOrderedTasks?: readonly { taskId: string; taskNumber: number }[];
  /** Where the back arrow returns to — see `returnTo` on the `task`
   * route in navigation.tsx (audit Block 3). */
  returnTo?: Route;
}

/**
 * Desktop Training screen (S1 Block 6, approved design —
 * desktop/04_training.png): a three-part composition — breadcrumb +
 * task card in the main column, "Инструменты" / "Прогресс в теме" /
 * "Задания" in the sidebar. Structurally its own layout, not a
 * scaled mobile screen.
 */
export function TaskDesktop({
  subjectId,
  taskNumber,
  taskId,
  collectionSlug,
  variantId,
  customOrderedTasks,
  returnTo,
}: TaskDesktopProps) {
  const { navigate, back } = useNavigation();
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]!;
  const taskNav = useTaskNavigation({
    subjectId,
    taskId,
    collectionSlug,
    variantId,
    customOrderedTasks,
    returnTo,
  });
  const goBack = returnTo ? () => navigate(returnTo) : back;
  const favorite = useFavorite(taskId);
  const learningSession = useActiveLearningSessionForTask(taskId);
  const { refreshStreak } = useStreakContext();
  const timer = useSolvingTimer();

  // The router remounts this component (key={taskId}) on every task
  // change, so state starts fresh here — no manual reset-on-taskId-change
  // effect needed.
  const [task, setTask] = useState<ReturnType<typeof toSampleTask> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answer, setAnswer] = useState('');
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTask(taskId), listTasksByNumber(subjectId, taskNumber)])
      .then(([fetchedTask, fetchedSiblings]) => {
        if (cancelled) return;
        setTask(toSampleTask(fetchedTask, fetchedSiblings));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, subjectId, taskNumber]);

  // Selecting a row in the real session/variant list (sidebar) — uses
  // the SAME ordered list the top TaskNumberStrip/prev-next already use
  // (taskNav.orderedTasks), never listTasksByNumber's cross-source
  // same-number siblings (a different task's "Задание 3" used to mean
  // "the 3rd task sharing this number from another variant", silently
  // jumping to the wrong place — see taskAdapter.ts's doc comment).
  function handleSelectSession(index: number) {
    const entry = taskNav.orderedTasks[index - 1];
    if (!entry) return;
    taskNav.goTo(entry);
  }

  // "Другие задания №N" (desktop): same cross-source sibling navigation
  // as TaskMobile's handleSelectVariant — explicitly drops the current
  // source/variant context (it belonged to the source we just left).
  function handleSelectVariant(variant: TaskVariant) {
    if (!task) return;
    navigate({
      screen: 'task',
      subjectId: task.subjectId,
      taskNumber: task.number,
      taskId: variant.id,
      returnTo: { screen: 'subject', subjectId: task.subjectId },
    });
  }

  // "К списку заданий №N" — see trainingByNumberRouteFor's doc comment.
  function handleGoToList() {
    if (!task) return;
    navigate(trainingByNumberRouteFor(task.subjectId, task.number));
  }

  const isMultiPart = task?.answerType === 'multi_part' && task.answerParts !== null;
  // Essay tasks (e.g. EGE Russian 27) have no single correct answer and
  // are never auto-graded — the backend rejects any attempt against
  // them (see EssayNotGradableError). The UI must not offer an answer
  // field or a "Проверить ответ" button that would just 400; instead it
  // shows the task's own explanation note directly (no attempt needed
  // to unlock it — see service.ts's getTask essay carve-out).
  const isEssay = task?.answerType === 'essay';
  const essayAck = useEssayAck(isEssay ? task?.id : undefined, task?.essayAcknowledged);
  const canSubmit = isMultiPart
    ? task!.answerParts!.every((p) => (partAnswers[p.id] ?? '').trim().length > 0) && !checking
    : answer.trim().length > 0 && !checking && task !== null;
  // The real position within the current session/list (customOrderedTasks
  // / variant / collection — same list the top TaskNumberStrip/prev-next
  // already use), never `task.indexInSession`/`task.totalInSession`
  // (just a safe single-item default — see taskAdapter.ts).
  const sessionProgress = task ? buildSessionProgress(task.id, taskNav.orderedTasks) : null;
  const progressPercent = sessionProgress
    ? (sessionProgress.indexInSession / sessionProgress.totalInSession) * 100
    : 0;

  function handleCheck() {
    if (!canSubmit || !task) return;
    setChecking(true);
    const submittedAnswer = isMultiPart ? { ...partAnswers } : answer.trim();
    const userAnswerForResult = isMultiPart
      ? serializeMultiPartUserAnswer(submittedAnswer as Record<string, string>)
      : (submittedAnswer as string);
    // Never counts the time the task sat open before "Начать" — only a
    // started timer produces a real timeSpentMs (see useSolvingTimer).
    const neverStarted = timer.status === 'idle';
    const elapsedMs = timer.finish();
    const timeSpentMs = neverStarted ? undefined : elapsedMs;
    void submitAttempt(task.id, { answer: submittedAnswer, timeSpentMs })
      .then((result) => {
        clearCanvasState(task.id);
        // Streak system: the attempt the backend just recorded as real
        // daily activity — refetch the server-computed state so the
        // header's "Серия" chip reflects it without a full reload.
        refreshStreak();
        navigate({
          screen: 'result',
          subjectId: task.subjectId,
          taskNumber: task.number,
          taskId: task.id,
          correct: result.correct,
          userAnswer: userAnswerForResult,
          collectionSlug,
          variantId: taskNav.variantId ?? undefined,
          // Carries the real session list forward so Result's own
          // useTaskNavigation resolves the SAME orderedTasks as this
          // screen did — without this, a customOrderedTasks-driven
          // session (e.g. "По номерам" single-number) lost all
          // navigation context on submit, and "Следующее задание"
          // showed disabled (navigation bugfix, round 2).
          customOrderedTasks,
          returnTo,
          timeSpentMs,
        });
      })
      .finally(() => setChecking(false));
  }

  if (loadError) {
    return (
      <FadeIn className={styles.page}>
        <p className="text-body-sm text-secondary">Не удалось загрузить задание.</p>
        <Button variant="secondary" onClick={goBack}>
          Назад
        </Button>
      </FadeIn>
    );
  }

  if (!task) {
    return (
      <FadeIn className={styles.page}>
        <p className="text-body-sm text-secondary">Загрузка задания…</p>
      </FadeIn>
    );
  }
  const progress = sessionProgress!;

  return (
    <FadeIn key={task.id} className={styles.page}>
      <div className={styles.breadcrumb}>
        <button type="button" className={styles.backButton} onClick={goBack} aria-label="Назад">
          <Icon name="back" size={18} />
        </button>
        <span>{subject.shortName}</span>
        <Icon name="chevronRight" size={14} />
        <span>Тренировка</span>
        <Icon name="chevronRight" size={14} />
        <span className={styles.breadcrumbCurrent}>Задание {progress.indexInSession}</span>
      </div>

      <div className={styles.grid}>
        <div className={styles.main}>
          <div className={styles.progressHeader}>
            <button
              type="button"
              className={styles.roundButton}
              onClick={() => (taskNav.previous ? taskNav.goTo(taskNav.previous) : goBack())}
              disabled={!taskNav.previous && taskNav.orderedTasks.length > 0}
              aria-label="Предыдущее задание"
            >
              <Icon name="back" size={18} />
            </button>
            <div className={styles.progressHeaderBar}>
              <span className="text-body-sm">
                Задание {progress.indexInSession} из {progress.totalInSession}
              </span>
              <ProgressBar value={progressPercent} label="Прогресс тренировки" />
            </div>
            <SolvingTimer timer={timer} />
            <button
              type="button"
              className={styles.roundButton}
              onClick={() => taskNav.next && taskNav.goTo(taskNav.next)}
              disabled={!taskNav.next}
              aria-label="Следующее задание"
            >
              <Icon name="arrowRight" size={18} />
            </button>
          </div>

          <div className={styles.card}>
            <div className={styles.metaRow}>
              {learningSession && <LearningSessionBadge session={learningSession} />}
              <span className={styles.currentChip}>Задание {progress.indexInSession}</span>
              <span className={styles.metaChip}>{task.topic}</span>
              <span className={styles.metaChip}>Показательные уравнения</span>
              <span className={styles.metaChip}>
                {task.difficultyLabel === 'Сложное' ? 'Базовый уровень' : task.difficultyLabel}
              </span>
              <span className={styles.metaSpacer} />
              <button
                type="button"
                className={clsx(styles.iconButton, favorite.isFavorite && styles.iconButtonActive)}
                aria-label={favorite.isFavorite ? 'Убрать из избранного' : 'В избранное'}
                aria-pressed={favorite.isFavorite ?? false}
                onClick={favorite.toggle}
              >
                <Icon name="bookmark" size={18} filled={favorite.isFavorite ?? false} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Пожаловаться на задание"
                onClick={() => setReportOpen(true)}
              >
                <Icon name="warning" size={18} />
              </button>
            </div>

            {task.passage && <PassageCard passage={task.passage} />}

            <p className="text-h3" style={{ marginTop: 'var(--space-2)' }}>
              Условие
            </p>
            <div className={clsx('text-task', styles.condition)}>
              <MathText text={task.condition} separateInstruction />
            </div>
            <TaskExamIllustration
              subjectId={task.subjectId}
              taskNumber={task.number}
              className={styles.taskImage}
            />

            {task.hint && (
              <>
                <button
                  type="button"
                  className={styles.hintToggle}
                  aria-expanded={hintOpen}
                  aria-label="Показать подсказку"
                  onClick={() => setHintOpen((v) => !v)}
                >
                  <Icon name="hint" size={16} /> Подсказка
                  <Icon name={hintOpen ? 'chevronUp' : 'chevronDown'} size={16} />
                </button>
                <Collapse open={hintOpen}>
                  <div className={clsx('text-body-sm', 'text-secondary', styles.hintText)}>
                    <MathText text={task.hint} />
                  </div>
                </Collapse>
              </>
            )}

            {isEssay ? (
              <EssayPanel
                explanation={task.explanation}
                sampleEssay={task.sampleEssay}
                acknowledged={essayAck.acknowledged}
                acknowledging={essayAck.acknowledging}
                onAcknowledge={essayAck.acknowledge}
              />
            ) : (
              <div>
                <p
                  className="text-body-sm"
                  style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}
                >
                  Введите ответ
                </p>
                {isMultiPart ? (
                  <div className={styles.multiPartFields}>
                    {task.answerParts!.map((part) => (
                      <div key={part.id} className={styles.answerRow}>
                        <span className={styles.multiPartLabel}>{part.label})</span>
                        <MathAnswerField
                          value={partAnswers[part.id] ?? ''}
                          onChange={(v) => setPartAnswers((prev) => ({ ...prev, [part.id]: v }))}
                          placeholder="Ваш ответ..."
                          disabled={checking}
                          ariaLabel={`Ответ ${part.label})`}
                          className={styles.mathField}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <MathAnswerField
                      value={answer}
                      onChange={setAnswer}
                      placeholder="Ваш ответ..."
                      disabled={checking}
                      ariaLabel="Ответ"
                    />
                    <p className={clsx('text-body-sm', 'text-secondary', styles.answerHelp)}>
                      Можно использовать: ∪ для объединения, ∩ для пересечения, ∞, дроби, скобки.
                      <br />
                      Например: (−∞; 1] ∪ [3; ∞)
                    </p>
                  </>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={!taskNav.next}
                onClick={() => taskNav.next && taskNav.goTo(taskNav.next)}
              >
                <Icon name="skip" size={16} /> {isEssay ? 'Следующее задание' : 'Пропустить'}
              </Button>
              {!isEssay && (
                <Button
                  variant="primary"
                  loading={checking}
                  disabled={!canSubmit}
                  onClick={handleCheck}
                >
                  Проверить ответ <Icon name="arrowRight" size={18} />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.sidebar}>
          <DesktopToolsCard
            onSelectHint={() => setHintOpen((v) => !v)}
            onSelectCalculator={() => setCalculatorOpen(true)}
            onSelectCanvas={() => setCanvasOpen(true)}
          />
          <SessionProgressCard
            sessionTasks={progress.sessionTasks}
            totalInSession={progress.totalInSession}
          />
          <SessionTaskListCard
            title="Задания"
            sessionTasks={progress.sessionTasks}
            onSelect={handleSelectSession}
          />
        </div>
      </div>

      <OtherVariantsSectionDesktop
        taskNumber={task.number}
        variants={task.otherVariants}
        open={otherOpen}
        onToggle={() => setOtherOpen((v) => !v)}
        onSelectVariant={handleSelectVariant}
        onGoToList={handleGoToList}
        subtitle="Похожие задания на эту тему"
      />
      <Modal open={calculatorOpen} onClose={() => setCalculatorOpen(false)} title="Калькулятор">
        <Calculator />
      </Modal>
      <CanvasWorkspaceDesktop
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
        taskId={task.id}
        task={task}
      />
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Задание">
        <ReportTaskContent taskId={task.id} />
      </Modal>
    </FadeIn>
  );
}
