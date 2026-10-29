import { useEffect, useState, type ElementType } from 'react';
import { useTaskExit } from '../../ui/LearningSession/useTaskExit.js';
import { trainingByNumberRouteFor, useNavigation, type Route } from '../../lib/navigation.js';
import { serializeMultiPartUserAnswer } from '@zybrilka/shared';
import { getTask, listTasksByNumber, submitAttempt } from '../../lib/api.js';
import { buildSessionProgress, toSampleTask } from '../../lib/taskAdapter.js';
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
import { CanvasWorkspaceMobile } from '../../ui/CanvasWorkspace/CanvasWorkspaceMobile.js';
import { clearCanvasState } from '../../lib/canvasSessionStore.js';
import { useAnswerDraft } from '../../lib/useAnswerDraft.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { BottomSheet } from '../../ui/BottomSheet/BottomSheet.js';
import { RuleButton } from '../../ui/Theory/RuleButton.js';
import { DifficultyTag } from '../../ui/Training/DifficultyTag.js';
import { TaskChrome } from '../../ui/Training/TaskChrome.js';
import { ToolsPanelMobile, ToolsToggleButton } from '../../ui/Training/ToolsPanelMobile.js';
import { MathAnswerField } from '../../ui/MathAnswerField/MathAnswerField.js';
import { OtherVariantsSection } from '../../ui/Training/OtherVariantsSection.js';
import { Collapse, ContentSwap, SlideUp } from '../../ui/motion/motion.js';
import { SkeletonTask } from '../../ui/Skeleton/Skeleton.js';
import { useTaskScreenContinuation } from '../../lib/useTaskScreenContinuation.js';
import { MathText } from '../../ui/MathText/MathText.js';
import { TaskExamIllustration } from '../../ui/TaskIllustration/TaskIllustration.js';
import { PassageCard } from '../../ui/Passage/PassageCard.js';
import { EssayPanel } from '../../ui/Essay/EssayPanel.js';
import { useEssayAck } from '../../lib/useEssayAck.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TaskMobile.module.css';

export interface TaskMobileProps {
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
 * Mobile Training/Task screen (S1 Block 6, approved design —
 * mobile/04_training.png + 04b_training_tools_hidden.png). 04b's
 * collapsed tools/variants state is the default; both are real
 * toggles, not two hardcoded screens.
 */
export function TaskMobile({
  subjectId,
  taskNumber,
  taskId,
  collectionSlug,
  variantId,
  customOrderedTasks,
  returnTo,
}: TaskMobileProps) {
  const { navigate } = useNavigation();
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]!;
  const taskNav = useTaskNavigation({
    subjectId,
    taskId,
    collectionSlug,
    variantId,
    customOrderedTasks,
    returnTo,
  });
  // The task/result has no address of its own, so the current history
  // entry IS the page underneath it: replace it with the exact place to
  // return to instead of pushing a duplicate stop onto the Back stack.
  const { goBack, exitSheet } = useTaskExit(taskId, returnTo);
  const learningSession = useActiveLearningSessionForTask(taskId);
  const { refreshStreak } = useStreakContext();
  const timer = useSolvingTimer();
  const continuing = useTaskScreenContinuation();

  // The router remounts this component (key={taskId}) on every task
  // change, so state starts fresh here — no manual reset-on-taskId-change
  // effect needed.
  const [task, setTask] = useState<ReturnType<typeof toSampleTask> | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Typed but unchecked answers survive moving to another number and back.
  const { answer, setAnswer, partAnswers, setPartAnswers, discardDraft } = useAnswerDraft(taskId);
  const [checking, setChecking] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getTask(taskId),
      listTasksByNumber(subjectId, taskNumber, undefined, undefined, taskId),
    ])
      .then(([fetchedTask, siblings]) => {
        if (cancelled) return;
        setTask(toSampleTask(fetchedTask, siblings));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, subjectId, taskNumber]);

  const isMultiPart = task?.answerType === 'multi_part' && task.answerParts !== null;
  // Essay tasks (e.g. EGE Russian 27) have no single correct answer and
  // are never auto-graded — see TaskDesktop's matching comment.
  const isEssay = task?.answerType === 'essay';
  const essayAck = useEssayAck(isEssay ? task?.id : undefined, task?.essayAcknowledged);
  const canSubmit = isMultiPart
    ? task!.answerParts!.every((p) => (partAnswers[p.id] ?? '').trim().length > 0) && !checking
    : answer.trim().length > 0 && !checking && task !== null;

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
    void submitAttempt(task.id, {
      answer: submittedAnswer,
      timeSpentMs,
      // Links the answer to this attempt of the variant / training (the
      // server checks it is really ours and served this task).
      sessionId: learningSession?.sessionId,
    })
      .then((result) => {
        clearCanvasState(task.id);
        discardDraft();
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
          // A guest's answer was checked but not recorded (attemptId null).
          revealed:
            result.attemptId === null
              ? {
                  correctAnswer: result.correctAnswer,
                  correctAnswerDisplay: result.correctAnswerDisplay,
                  explanation: result.explanation,
                }
              : undefined,
        });
      })
      .finally(() => setChecking(false));
  }

  function handleSelectVariant(variant: TaskVariant) {
    if (!task) return;
    // Cross-source sibling ("Похожие задания на эту тему") — explicitly
    // drop the current source/variant context, same as TaskDesktop's
    // handleSelectSession. The old return context no longer applies
    // (it belonged to the source we just left), so back now returns to
    // the subject's default view rather than falling through to the
    // stale `returnTo` or the old collapse-to-Home bug.
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

  if (loadError) {
    return (
      <SlideUp className={styles.stack}>
        <p className="text-body-sm text-secondary">Не удалось загрузить задание.</p>
        <Button variant="secondary" onClick={goBack}>
          Назад
        </Button>
        {exitSheet}
      </SlideUp>
    );
  }

  // The chrome — header, number strip, progress — needs only what the route
  // already says (task id and number), so it switches the moment a number is
  // picked; only the task's own content waits for the network.
  const sessionProgress = buildSessionProgress(taskId, taskNav.orderedTasks, taskNav.marks);
  const chrome = (
    <TaskChrome
      subject={subject}
      taskId={taskId}
      taskNumber={taskNumber}
      onBack={goBack}
      numberStripRange={taskNav.orderedTasks}
      onSelectNumber={taskNav.goTo}
      marks={taskNav.marks}
      previous={taskNav.previous}
      next={taskNav.next}
      onGoTo={taskNav.goTo}
      indexInSession={sessionProgress.indexInSession}
      totalInSession={sessionProgress.totalInSession}
      reportScreen="task"
      variantId={taskNav.variantId ?? variantId}
    />
  );
  // Switching from another task: the screen is already here — no entrance.
  const Stack: ElementType = continuing ? 'div' : SlideUp;

  if (!task) {
    return (
      <Stack className={styles.stack}>
        {chrome}
        {exitSheet}
        <SkeletonTask />
      </Stack>
    );
  }

  return (
    <Stack className={styles.stack}>
      {chrome}
      {exitSheet}

      <ContentSwap>
        <div className={styles.timerRow}>
          <SolvingTimer timer={timer} />
        </div>

        <div className={styles.card}>
          <div className={styles.metaRow}>
            {learningSession && <LearningSessionBadge session={learningSession} />}
            <DifficultyTag label={task.difficultyLabel} />
            <span className={styles.metaChip}>
              <Icon name="reference" size={12} /> {task.source}
            </span>
            <span className={styles.metaChip}>
              <Icon name="topic" size={12} /> {task.topic}
            </span>
            <span className={styles.metaCode}>
              {task.code} <Icon name="info" size={14} />
            </span>
          </div>

          {task.passage && <PassageCard passage={task.passage} />}

          <div className={clsx('text-task', styles.condition)}>
            <MathText text={task.condition} separateInstruction />
          </div>
          <TaskExamIllustration
            subjectId={task.subjectId}
            taskNumber={task.number}
            tags={task.tags}
            imageUrl={task.imageUrl}
            className={styles.taskImage}
          />
          <RuleButton
            subjectId={task.subjectId}
            taskNumber={task.number}
            presentation="sheet"
            className={styles.ruleButton}
          />

          {task.hint && (
            <div className={styles.hintWrap}>
              <button
                type="button"
                className={styles.hintSummary}
                aria-expanded={hintOpen}
                onClick={() => setHintOpen((v) => !v)}
              >
                <Icon name="hint" size={18} className={styles.hintIcon} />
                <span className="text-body-sm" style={{ flex: 1, textAlign: 'left' }}>
                  Подсказка
                </span>
                <Icon name={hintOpen ? 'chevronUp' : 'chevronDown'} size={18} />
              </button>
              <Collapse open={hintOpen}>
                <div className={clsx('text-body-sm', 'text-secondary', styles.hintText)}>
                  <MathText text={task.hint} />
                </div>
              </Collapse>
            </div>
          )}

          {isEssay ? (
            <EssayPanel
              explanation={task.explanation}
              sampleEssay={task.sampleEssay}
              acknowledged={essayAck.acknowledged}
              acknowledging={essayAck.acknowledging}
              onAcknowledge={essayAck.acknowledge}
            />
          ) : isMultiPart ? (
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
              <div className={styles.answerRow}>
                <MathAnswerField
                  value={answer}
                  onChange={setAnswer}
                  placeholder="Введите ответ..."
                  disabled={checking}
                  ariaLabel="Ответ"
                  className={styles.mathField}
                />
                <ToolsToggleButton
                  toolsOpen={toolsOpen}
                  onToggleTools={() => setToolsOpen((v) => !v)}
                />
              </div>
              <p className={clsx('text-body-sm', 'text-secondary', styles.answerHelp)}>
                Ответ можно вводить в виде интервала, объединения интервалов или чисел, например:
                (−∞; −1] ∪ [2; +∞)
              </p>
            </>
          )}

          {!isEssay && (
            <Button
              variant="primary"
              fullWidth
              loading={checking}
              disabled={!canSubmit}
              onClick={handleCheck}
            >
              Проверить ответ <Icon name="arrowRight" size={18} />
            </Button>
          )}
          <div className={styles.secondaryActions}>
            <Button
              variant="secondary"
              fullWidth
              disabled={!taskNav.next}
              onClick={() => taskNav.next && taskNav.goTo(taskNav.next)}
            >
              <Icon name="skip" size={16} /> {isEssay ? 'Следующее задание' : 'Пропустить'}
            </Button>
          </div>
        </div>

        <ToolsPanelMobile
          open={toolsOpen}
          onToggle={() => setToolsOpen((v) => !v)}
          hideSummary
          onSelect={(toolId) => {
            if (toolId === 'calculator') setCalculatorOpen(true);
            if (toolId === 'canvas') setCanvasOpen(true);
          }}
        />

        <OtherVariantsSection
          taskNumber={task.number}
          variants={task.otherVariants}
          open={otherOpen}
          onToggle={() => setOtherOpen((v) => !v)}
          onSelectVariant={handleSelectVariant}
          onGoToList={handleGoToList}
          summarySubtitle="Похожие задания на эту тему"
        />
      </ContentSwap>

      <BottomSheet
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        title="Калькулятор"
      >
        <Calculator />
      </BottomSheet>

      <CanvasWorkspaceMobile
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
        taskId={task.id}
        task={task}
      />
    </Stack>
  );
}
