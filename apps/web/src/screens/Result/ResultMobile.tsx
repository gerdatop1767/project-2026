import { useEffect, useState } from 'react';
import { useNavigation, type Route } from '../../lib/navigation.js';
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
import { getProgressSummary } from '../../lib/api.js';
import { Button } from '../../ui/Button/Button.js';
import { Calculator } from '../../ui/Calculator/Calculator.js';
import { CanvasWorkspaceMobile } from '../../ui/CanvasWorkspace/CanvasWorkspaceMobile.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { BottomSheet } from '../../ui/BottomSheet/BottomSheet.js';
import { TaskChrome } from '../../ui/Training/TaskChrome.js';
import { ToolsPanelMobile } from '../../ui/Training/ToolsPanelMobile.js';
import { OtherVariantsSection } from '../../ui/Training/OtherVariantsSection.js';
import { useCountUp } from '../../lib/useCountUp.js';
import { Collapse, SlideUp } from '../../ui/motion/motion.js';
import { InlineMathText, MathText } from '../../ui/MathText/MathText.js';
import {
  TaskExamIllustration,
  TaskSolutionIllustration,
} from '../../ui/TaskIllustration/TaskIllustration.js';
import { CanonicalSolutionView } from '../../ui/CanonicalSolution/CanonicalSolutionView.js';
import { clsx } from '../../lib/clsx.js';
import styles from './ResultMobile.module.css';

export interface ResultMobileProps {
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
   * which case no time chip is shown at all rather than a fabricated one. */
  timeSpentMs?: number;
}

const XP_REWARD = 20;

/**
 * Mobile Result screen (S1 Block 6, approved design —
 * mobile/05_correct.png / mobile/06_wrong.png): the same task chrome
 * (header, number strip, progress) as Training, with the middle card
 * replaced by the feedback state. Tools/other-variants stay collapsed
 * by default here too, matching the approved screenshots.
 */
export function ResultMobile({
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
}: ResultMobileProps) {
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
  // The router remounts this component (key={taskId}) whenever the task
  // or its correctness changes, so state starts fresh here.
  const [task, setTask] = useState<SampleTask | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [accuracyPercent, setAccuracyPercent] = useState<number | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void getProgressSummary()
      .then((data) => {
        if (!cancelled) setAccuracyPercent(Math.round(data.accuracyPercent));
      })
      .catch(() => {
        // No backend data yet (or the request failed) — the accuracy
        // chip stays hidden below rather than showing a fabricated number.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <SlideUp className={styles.stack}>
        <p className="text-body-sm text-secondary">Не удалось загрузить результат.</p>
        <Button variant="secondary" onClick={goBack}>
          Назад
        </Button>
      </SlideUp>
    );
  }

  if (!task) {
    return (
      <SlideUp className={styles.stack}>
        <p className="text-body-sm text-secondary">Загрузка результата…</p>
      </SlideUp>
    );
  }

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

  const multiPartSpec =
    task.answerType === 'multi_part' ? parseMultiPartSpec(task.correctAnswer) : null;
  const multiPartUserAnswer = multiPartSpec ? parseMultiPartUserAnswer(userAnswer) : null;
  const multiPartGrade =
    multiPartSpec && multiPartUserAnswer
      ? gradeMultiPart(multiPartSpec, multiPartUserAnswer)
      : null;
  const explanationSections = multiPartGrade ? splitMultiPartExplanation(task.explanation) : null;

  function handleSelectVariant(variant: TaskVariant) {
    if (!task) return;
    // Cross-source sibling — explicitly drop the current source/variant
    // context, same as TaskMobile's handleSelectVariant (and the old
    // `returnTo` with it — it belonged to the source we just left).
    navigate({
      screen: 'task',
      subjectId: task.subjectId,
      taskNumber: task.number,
      taskId: variant.id,
      returnTo: { screen: 'subject', subjectId: task.subjectId },
    });
  }

  const sessionProgress = buildSessionProgress(task.id, taskNav.orderedTasks);

  return (
    <SlideUp key={`${taskId}-${correct}`} className={styles.stack}>
      <TaskChrome
        subject={subject}
        task={task}
        onBack={goBack}
        numberStripRange={taskNav.orderedTasks}
        onSelectNumber={taskNav.goTo}
        previous={taskNav.previous}
        next={taskNav.next}
        onGoTo={taskNav.goTo}
        indexInSession={sessionProgress.indexInSession}
        totalInSession={sessionProgress.totalInSession}
      />

      <div
        className={clsx(
          styles.feedbackCard,
          correct ? styles.feedbackCorrect : styles.feedbackWrong,
        )}
      >
        {learningSession && (
          <div className={styles.statRow}>
            <LearningSessionBadge session={learningSession} />
          </div>
        )}
        {/* QA v3 Block 2: the task itself — same renderer/order as
         * TaskMobile and ResultDesktop's "Условие" card — so the user
         * sees "вот какое было задание" before the result below it,
         * instead of landing straight on correct/incorrect with no
         * memory of what they just answered. */}
        <div className={clsx('text-task', styles.condition)}>
          <MathText text={task.condition} />
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

        <span
          className={clsx(styles.feedbackIcon, correct ? styles.iconCorrect : styles.iconWrong)}
        >
          <Icon name={correct ? 'check' : 'close'} size={32} />
        </span>
        <p className="text-h2">{correct ? 'Правильно!' : 'Неправильно!'}</p>
        <p className="text-body-sm text-secondary">
          {correct ? 'Отличная работа!' : 'Не переживай, разберём вместе!'}
        </p>

        <div className={styles.statRow}>
          <span className={styles.statChip}>
            <Icon name="xp" size={16} className={styles.statIconGold} />+{Math.round(xp)} XP
          </span>
          {timeSpentMs !== undefined && (
            <span className={styles.statChip}>
              <Icon name="progress" size={16} className={styles.statIconBlue} />
              Время {formatElapsed(timeSpentMs)}
            </span>
          )}
          {accuracyPercent !== null && (
            <span className={styles.statChip}>
              <Icon name="star" size={16} className={styles.statIconGold} />
              Точность {accuracyPercent}%
            </span>
          )}
        </div>

        {multiPartGrade && multiPartUserAnswer ? (
          <div className={styles.answerBlock}>
            {multiPartGrade.parts.map((part) => (
              <div key={part.id}>
                <p className="text-body-sm text-secondary">{part.label}) Твой ответ:</p>
                <p
                  className={clsx(
                    styles.answerBox,
                    part.correct ? styles.answerBoxCorrect : styles.answerBoxWrong,
                  )}
                >
                  {multiPartUserAnswer[part.id] || '—'}
                  <Icon name={part.correct ? 'check' : 'close'} size={18} />
                </p>
                {!part.correct && (
                  <p className={clsx(styles.answerBox, styles.answerBoxReference)}>
                    <InlineMathText
                      text={multiPartSpec!.parts.find((p) => p.id === part.id)?.correctAnswer ?? ''}
                    />
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.answerBlock}>
            <p className="text-body-sm text-secondary">Твой ответ:</p>
            <p
              className={clsx(
                styles.answerBox,
                correct ? styles.answerBoxCorrect : styles.answerBoxWrong,
              )}
            >
              {userAnswer || '—'}
              <Icon name={correct ? 'check' : 'close'} size={18} />
            </p>
            {!correct && (
              <>
                <p className="text-body-sm text-secondary">Правильный ответ:</p>
                <p className={clsx(styles.answerBox, styles.answerBoxReference)}>
                  <InlineMathText text={task.correctAnswerDisplay ?? task.correctAnswer} />
                </p>
              </>
            )}
          </div>
        )}

        <Button variant="primary" fullWidth onClick={() => setSolutionOpen((v) => !v)}>
          <Icon name="showSolution" size={18} /> Показать решение
        </Button>
        <Collapse open={solutionOpen}>
          <div className={styles.solutionSteps}>
            {multiPartGrade && explanationSections
              ? multiPartGrade.parts.map((part, i) => (
                  <div key={part.id} className={styles.solutionStep}>
                    <span className={styles.solutionStepIndex}>{i + 1}</span>
                    <p className={clsx('text-body-sm', styles.solutionStepBody)}>
                      <strong>{part.label}) </strong>
                      <InlineMathText text={explanationForPart(explanationSections, part.label)} />
                    </p>
                  </div>
                ))
              : task.steps.map((step, i) => (
                  <div key={i} className={styles.solutionStep}>
                    <span className={styles.solutionStepIndex}>{i + 1}</span>
                    <div className={styles.solutionStepBody}>
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
                ))}
          </div>
          {task.canonicalSolution && (
            <div className={styles.canonicalSolutionWrap}>
              <CanonicalSolutionView canonicalSolution={task.canonicalSolution} />
            </div>
          )}
        </Collapse>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={goToNext} disabled={!taskNav.next}>
            Следующее задание <Icon name="arrowRight" size={16} />
          </Button>
          <Button variant="secondary" onClick={goToTaskList}>
            <Icon name="grid" size={16} /> К списку заданий
          </Button>
        </div>

        {learningSession && (
          <div className={styles.actions}>
            <LearningSessionResultAction session={learningSession} />
          </div>
        )}
      </div>

      <ToolsPanelMobile
        open={toolsOpen}
        onToggle={() => setToolsOpen((v) => !v)}
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
        summarySubtitle="Похожее на это задание"
      />

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
    </SlideUp>
  );
}
