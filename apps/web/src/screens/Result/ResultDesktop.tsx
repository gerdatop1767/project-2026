import { useEffect, useState } from 'react';
import { trainingByNumberRouteFor, useNavigation, type Route } from '../../lib/navigation.js';
import { gradeMultiPart, parseMultiPartSpec, parseMultiPartUserAnswer } from '@zybrilka/shared';
import { getTask, listTasksByNumber } from '../../lib/api.js';
import {
  buildSessionProgress,
  explanationForPart,
  splitMultiPartExplanation,
  toSampleTask,
} from '../../lib/taskAdapter.js';
import { useTaskNavigation } from '../../lib/useTaskNavigation.js';
import { useActiveLearningSessionForTask } from '../../lib/learningSessionContext.js';
import { formatElapsed } from '../../lib/formatElapsed.js';
import { LearningSessionBadge } from '../../ui/LearningSession/LearningSessionBadge.js';
import { LearningSessionResultAction } from '../../ui/LearningSession/LearningSessionResultAction.js';
import type { SampleTask, TaskVariant } from '../../data/sampleTask.js';
import { subjects } from '../../data/subjects.js';
import { Button } from '../../ui/Button/Button.js';
import { Calculator } from '../../ui/Calculator/Calculator.js';
import { CanvasWorkspaceDesktop } from '../../ui/CanvasWorkspace/CanvasWorkspaceDesktop.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Modal } from '../../ui/Modal/Modal.js';
import { DesktopToolsCard } from '../../ui/Training/DesktopToolsCard.js';
import { OtherVariantsSectionDesktop } from '../../ui/Training/OtherVariantsSectionDesktop.js';
import { SessionTaskListCard } from '../../ui/Training/SessionTaskListCard.js';
import { ProgressBar } from '../../ui/Progress/ProgressBar.js';
import { useCountUp } from '../../lib/useCountUp.js';
import { FadeIn } from '../../ui/motion/motion.js';
import { InlineMathText, MathText } from '../../ui/MathText/MathText.js';
import {
  TaskExamIllustration,
  TaskSolutionIllustration,
} from '../../ui/TaskIllustration/TaskIllustration.js';
import { CanonicalSolutionView } from '../../ui/CanonicalSolution/CanonicalSolutionView.js';
import { PassageCard } from '../../ui/Passage/PassageCard.js';
import { clsx } from '../../lib/clsx.js';
import styles from './ResultDesktop.module.css';

export interface ResultDesktopProps {
  subjectId: string;
  taskNumber: number;
  taskId: string;
  correct: boolean;
  userAnswer: string;
  collectionSlug?: string;
  variantId?: string;
  /** A user-assembled task list (see navigation.tsx's `task.customOrderedTasks`) — takes over the number strip / prev-next ordering when present. */
  customOrderedTasks?: readonly { taskId: string; taskNumber: number }[];
  /** Where the back arrow returns to — see `returnTo` on the `result`
   * route in navigation.tsx (audit Block 3). */
  returnTo?: Route;
  /** The real elapsed solving time submitted with this attempt (see
   * `useSolvingTimer`) — absent when the timer was never started, in
   * which case no time is shown at all rather than a fabricated one. */
  timeSpentMs?: number;
}

const XP_REWARD = 20;

/**
 * Desktop Result screen (S1 Block 6, approved design —
 * desktop/05_correct.png / desktop/06_wrong.png): the feedback banner
 * and answer comparison live inline in the main task card, and the
 * sidebar swaps "Инструменты"/"Прогресс в теме" for "Результат" +
 * the session task list — matching the approved compositions exactly,
 * not a recolored Training screen.
 */
export function ResultDesktop({
  subjectId,
  taskNumber,
  taskId,
  correct,
  userAnswer,
  collectionSlug,
  variantId,
  customOrderedTasks,
  returnTo,
  timeSpentMs,
}: ResultDesktopProps) {
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
  const learningSession = useActiveLearningSessionForTask(taskId);
  function retryTask() {
    navigate({
      screen: 'task',
      subjectId,
      taskNumber,
      taskId,
      collectionSlug,
      variantId: taskNav.variantId ?? undefined,
      // Same navigation-context carry as goToNext — otherwise retrying
      // a wrong answer in a customOrderedTasks session (e.g. "По
      // номерам" single-number) silently drops back to "1 из 1".
      customOrderedTasks,
      returnTo,
    });
  }
  // The router remounts this component (key={taskId}) whenever the task
  // or its correctness changes, so state starts fresh here.
  const [task, setTask] = useState<SampleTask | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [detailedSolution, setDetailedSolution] = useState(true);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const xp = useCountUp(correct ? XP_REWARD : 0, 500);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTask(taskId), listTasksByNumber(subjectId, taskNumber)])
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

  if (loadError) {
    return (
      <FadeIn className={styles.page}>
        <p className="text-body-sm text-secondary">Не удалось загрузить результат.</p>
        <Button variant="secondary" onClick={goBack}>
          Назад
        </Button>
      </FadeIn>
    );
  }

  if (!task) {
    return (
      <FadeIn className={styles.page}>
        <p className="text-body-sm text-secondary">Загрузка результата…</p>
      </FadeIn>
    );
  }

  // The real position within the current session/list — same ordered
  // list the top TaskNumberStrip/prev-next already use, never
  // `task.indexInSession`/`task.totalInSession` (a safe single-item
  // default — see taskAdapter.ts).
  const progress = buildSessionProgress(task.id, taskNav.orderedTasks);
  const progressPercent = (progress.indexInSession / progress.totalInSession) * 100;
  const displayedAnswer = userAnswer || '—';

  const multiPartSpec =
    task.answerType === 'multi_part' ? parseMultiPartSpec(task.correctAnswer) : null;
  const multiPartUserAnswer = multiPartSpec ? parseMultiPartUserAnswer(userAnswer) : null;
  const multiPartGrade =
    multiPartSpec && multiPartUserAnswer
      ? gradeMultiPart(multiPartSpec, multiPartUserAnswer)
      : null;
  const explanationSections = multiPartGrade ? splitMultiPartExplanation(task.explanation) : null;

  function goToNext() {
    if (!taskNav.next) return;
    taskNav.goTo(taskNav.next);
  }

  function goToTaskList() {
    if (!task) return;
    navigate({
      screen: 'subject',
      subjectId: task.subjectId,
      collectionSlug,
      initialMode: 'topics',
    });
  }

  // "Другие задания №N" (desktop): same cross-source sibling navigation
  // as ResultMobile's handleSelectVariant — explicitly drops the
  // current source/variant context (it belonged to the source we just
  // left).
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

  return (
    <FadeIn key={`${taskId}-${correct}`} className={styles.page}>
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
              onClick={goBack}
              aria-label="Назад"
            >
              <Icon name="back" size={18} />
            </button>
            <div className={styles.progressHeaderBar}>
              <span className="text-body-sm">
                Задание {progress.indexInSession} из {progress.totalInSession}
              </span>
              <ProgressBar value={progressPercent} label="Прогресс тренировки" />
            </div>
            {timeSpentMs !== undefined && (
              <span className={styles.timer}>
                <Icon name="time" size={16} /> {formatElapsed(timeSpentMs)}
              </span>
            )}
            <button
              type="button"
              className={styles.roundButton}
              onClick={goToNext}
              disabled={!taskNav.next}
              aria-label="Перейти дальше"
            >
              <Icon name="arrowRight" size={18} />
            </button>
          </div>

          <div className={styles.card}>
            {learningSession && <LearningSessionBadge session={learningSession} />}
            {!correct && <span className={styles.topicChip}>{task.topic}</span>}
            {task.passage && <PassageCard passage={task.passage} />}
            <p className="text-h3">Условие</p>
            <div className={clsx('text-task', styles.condition)}>
              <MathText text={task.condition} separateInstruction />
            </div>
            <TaskExamIllustration
              subjectId={task.subjectId}
              taskNumber={task.number}
              className={styles.taskImage}
            />
            <TaskSolutionIllustration
              subjectId={task.subjectId}
              taskNumber={task.number}
              className={styles.taskImage}
            />

            <div
              className={clsx(
                styles.feedbackBanner,
                correct ? styles.feedbackCorrect : styles.feedbackWrong,
              )}
            >
              <span
                className={clsx(
                  styles.feedbackIcon,
                  correct ? styles.iconCorrect : styles.iconWrong,
                )}
              >
                <Icon name={correct ? 'check' : 'close'} size={22} />
              </span>
              <div className={styles.feedbackText}>
                <p className={clsx('text-h3', correct ? styles.textCorrect : styles.textWrong)}>
                  {correct ? 'Правильно!' : 'Неверно'}
                </p>
                <p className="text-body-sm text-secondary">
                  {correct ? 'Ты отлично справился!' : 'Разберём это задание вместе.'}
                </p>
              </div>
              {correct && (
                <div className={styles.rewardChips}>
                  <span className={styles.rewardChip}>
                    <Icon name="target" size={16} className={styles.rewardIconGold} />+
                    {Math.round(xp)} XP
                    <span className="text-label text-secondary">Опыт</span>
                  </span>
                </div>
              )}
            </div>

            {multiPartGrade && explanationSections ? (
              <div className={styles.steps}>
                {multiPartGrade.parts.map((part) => (
                  <div key={part.id} className={styles.card} style={{ padding: 'var(--space-4)' }}>
                    <div className={styles.answerCompare}>
                      <span className="text-body-sm" style={{ fontWeight: 700 }}>
                        {part.label}) {part.correct ? 'Верно' : 'Неверно'}
                      </span>
                      <span className="text-body-sm text-secondary">Твой ответ:</span>
                      <p
                        className={clsx(
                          styles.answerValue,
                          part.correct ? styles.answerValueCorrect : styles.answerValueWrong,
                        )}
                      >
                        {multiPartUserAnswer?.[part.id] || '—'}
                      </p>
                      {!part.correct && (
                        <>
                          <span className="text-body-sm text-secondary">Правильный ответ:</span>
                          <p className={clsx(styles.answerValue, styles.answerValueReference)}>
                            <InlineMathText
                              text={
                                multiPartSpec!.parts.find((p) => p.id === part.id)?.correctAnswer ??
                                ''
                              }
                            />
                          </p>
                        </>
                      )}
                    </div>
                    <p className="text-body-sm" style={{ marginTop: 'var(--space-2)' }}>
                      <InlineMathText text={explanationForPart(explanationSections, part.label)} />
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className={styles.answerCompare}>
                  <span className="text-body-sm text-secondary">Твой ответ:</span>
                  <p
                    className={clsx(
                      styles.answerValue,
                      correct ? styles.answerValueCorrect : styles.answerValueWrong,
                    )}
                  >
                    {displayedAnswer}
                  </p>
                  {!correct && (
                    <>
                      <span className="text-body-sm text-secondary">Правильный ответ:</span>
                      <p className={clsx(styles.answerValue, styles.answerValueReference)}>
                        <InlineMathText text={task.correctAnswerDisplay ?? task.correctAnswer} />
                      </p>
                    </>
                  )}
                </div>

                <div className={styles.solutionHeader}>
                  <p className="text-h3">{correct ? 'Пошаговое решение' : 'Решение'}</p>
                  {!correct && (
                    <div className={styles.solutionToggle}>
                      <button
                        type="button"
                        className={clsx(!detailedSolution && styles.solutionToggleActive)}
                        onClick={() => setDetailedSolution(false)}
                      >
                        Краткое решение
                      </button>
                      <button
                        type="button"
                        className={clsx(detailedSolution && styles.solutionToggleActive)}
                        onClick={() => setDetailedSolution(true)}
                      >
                        Подробное решение
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.steps}>
                  {(correct || detailedSolution ? task.steps : task.steps.slice(-1)).map(
                    (step, i) => {
                      const stepNumber = correct || detailedSolution ? i + 1 : task.steps.length;
                      return (
                        <div key={stepNumber} className={styles.step}>
                          <span className={styles.stepIndex}>{stepNumber}</span>
                          <div className={styles.stepBody}>
                            {step.title && (
                              <p className="text-body-sm" style={{ fontWeight: 700 }}>
                                <InlineMathText text={step.title} />
                              </p>
                            )}
                            <p className="text-body-sm">
                              <InlineMathText text={step.text} />
                            </p>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </>
            )}

            {task.canonicalSolution && (
              <CanonicalSolutionView canonicalSolution={task.canonicalSolution} />
            )}

            {!correct && task.hint && (
              <div className={styles.tipBox}>
                <Icon name="hint" size={18} className={styles.tipIcon} />
                <div className={styles.stepBody}>
                  <p className="text-body-sm" style={{ fontWeight: 600 }}>
                    Полезно знать
                  </p>
                  <p className="text-body-sm text-secondary">
                    <InlineMathText text={task.hint} />
                  </p>
                </div>
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={correct ? goToTaskList : retryTask}>
                {correct ? <Icon name="grid" size={16} /> : <Icon name="retry" size={16} />}
                {correct ? 'К списку заданий' : 'Попробовать ещё раз'}
              </Button>
              <Button variant="primary" onClick={goToNext} disabled={!taskNav.next}>
                Следующее задание <Icon name="arrowRight" size={18} />
              </Button>
            </div>

            {learningSession && (
              <div className={styles.actions}>
                <LearningSessionResultAction session={learningSession} />
              </div>
            )}
          </div>
        </div>

        <div className={styles.sidebar}>
          <ResultCard
            correct={correct}
            userAnswer={
              multiPartGrade && multiPartUserAnswer
                ? multiPartGrade.parts
                    .map((p) => `${p.label}) ${multiPartUserAnswer[p.id] || '—'}`)
                    .join(', ')
                : displayedAnswer
            }
            correctAnswer={
              multiPartSpec
                ? multiPartSpec.parts.map((p) => `${p.label}) ${p.correctAnswer}`).join(', ')
                : (task.correctAnswerDisplay ?? task.correctAnswer)
            }
            resultSummary={
              multiPartGrade
                ? `${multiPartGrade.correctParts} из ${multiPartGrade.totalParts}`
                : null
            }
            xp={xp}
          />
          {correct ? (
            <SessionTaskListCard
              title="Задания в теме"
              sessionTasks={progress.sessionTasks}
              onSelect={() => undefined}
            />
          ) : (
            <>
              <SessionTaskListCard
                title="Задания"
                sessionTasks={progress.sessionTasks}
                onSelect={() => undefined}
              />
              <DesktopToolsCard
                onSelectHint={() => undefined}
                onSelectCalculator={() => setCalculatorOpen(true)}
                onSelectCanvas={() => setCanvasOpen(true)}
              />
            </>
          )}
        </div>
      </div>

      <OtherVariantsSectionDesktop
        taskNumber={task.number}
        variants={task.otherVariants}
        open={otherOpen}
        onToggle={() => setOtherOpen((v) => !v)}
        onSelectVariant={handleSelectVariant}
        onGoToList={handleGoToList}
        subtitle="Похожие на это задание"
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
    </FadeIn>
  );
}

function ResultCard({
  correct,
  userAnswer,
  correctAnswer,
  resultSummary,
  xp,
}: {
  correct: boolean;
  userAnswer: string;
  correctAnswer: string;
  /** "2 из 3" for a multi_part task, shown next to the headline instead of plain correct/incorrect. */
  resultSummary: string | null;
  xp: number;
}) {
  return (
    <div className={styles.resultCard}>
      <p className="text-h3">Результат</p>
      <div className={styles.resultHead}>
        <span className={clsx(styles.resultIcon, correct ? styles.iconCorrect : styles.iconWrong)}>
          <Icon name={correct ? 'check' : 'close'} size={20} />
        </span>
        <div>
          <p
            className={clsx('text-body', correct ? styles.textCorrect : styles.textWrong)}
            style={{ fontWeight: 700 }}
          >
            {correct ? 'Правильно!' : 'Неверно'}
          </p>
          <p className="text-body-sm text-secondary">
            {resultSummary
              ? `Верно частей: ${resultSummary}`
              : correct
                ? 'Верный ответ'
                : 'Попробуй ещё раз'}
          </p>
        </div>
      </div>
      <div className={styles.resultRows}>
        <div className={styles.resultRow}>
          <span className="text-body-sm text-secondary">Твой ответ</span>
          <span className="text-body-sm">{userAnswer}</span>
        </div>
        <div className={styles.resultRow}>
          <span className="text-body-sm text-secondary">Правильный ответ</span>
          <span className="text-body-sm">
            <InlineMathText text={correctAnswer} />
          </span>
        </div>
        <div className={styles.resultRow}>
          <span className="text-body-sm text-secondary">Получено опыта</span>
          <span className={clsx('text-body-sm', styles.resultHighlight)}>+{Math.round(xp)} XP</span>
        </div>
      </div>
    </div>
  );
}
