import { useEffect, useState } from 'react';
import type {
  VariantAttemptDetail,
  VariantAttemptGroup,
  VariantAttemptTask,
  VariantTaskOutcome,
} from '@zybrilka/shared';
import { getVariantAttempt } from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import { formatDateShort } from '../../lib/formatDate.js';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { formatDurationLong } from '../../lib/statisticsDetailFormat.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { InlineMathText, MathText } from '../../ui/MathText/MathText.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { Collapse, SlideUp } from '../../ui/motion/motion.js';
import styles from './VariantAttempt.module.css';

export interface VariantAttemptProps {
  sessionId: string;
  /** Inside the finished-session screen: no own back row. */
  embedded?: boolean;
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; data: VariantAttemptDetail };

const outcomeLabel: Record<VariantTaskOutcome, string> = {
  correct: 'Верно',
  incorrect: 'Неверно',
  skipped: 'Пропущено',
  not_reached: 'Не решалось',
};

/**
 * The full result of ONE attempt of a variant (GET /progress/variants/:id):
 * score, every task with the user's answer, the right one and its
 * explanation, results by task number and topic, and what to go over
 * again. Only what the server recorded — nothing estimated.
 */
export function VariantAttempt({ sessionId, embedded = false }: VariantAttemptProps) {
  const { navigate } = useNavigation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    // Mounted per attempt (keyed by its id), so it starts out loading.
    let cancelled = false;
    getVariantAttempt(sessionId).then(
      (data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      },
      (error: unknown) => {
        if (cancelled) return;
        const status = (error as { status?: number }).status;
        setLoad({ status: status === 404 ? 'missing' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const back = embedded ? null : <BackRow to={{ screen: 'statistics' }} label="Статистика" />;

  if (load.status === 'loading') {
    return (
      <SlideUp className={styles.page}>
        {back}
        <div aria-busy="true" aria-label="Результат загружается" className={styles.stack}>
          <Skeleton height={140} />
          <Skeleton height={260} />
        </div>
      </SlideUp>
    );
  }
  if (load.status !== 'ready') {
    return (
      <SlideUp className={styles.page}>
        {back}
        <Card role="alert" className={styles.stack}>
          <p className="text-body">
            {load.status === 'missing'
              ? 'Эта попытка не найдена.'
              : 'Не удалось загрузить результат — попробуй ещё раз.'}
          </p>
          <Button variant="secondary" onClick={() => navigate({ screen: 'statistics' })}>
            К статистике
          </Button>
        </Card>
      </SlideUp>
    );
  }

  const d = load.data;
  const answered = d.correctCount + d.incorrectCount;
  const here: Route = { screen: 'variantAttempt', sessionId: d.sessionId };
  const openTask = (task: { taskId: string; taskNumber: number }) =>
    navigate({
      screen: 'task',
      subjectId: d.subjectId,
      taskNumber: task.taskNumber,
      taskId: task.taskId,
      variantId: d.variantId,
      returnTo: here,
    });

  return (
    <SlideUp className={styles.page}>
      {back}
      <header className={styles.head}>
        <h1 className="text-h1">Вариант {d.variantNumber}</h1>
        <p className="text-body-sm text-secondary">
          {d.variantTitle} · {formatDateShort(d.startedAt)}
          {d.status === 'active' && ' · не завершён'}
        </p>
      </header>

      <Card className={styles.score}>
        <p className={styles.scoreMain}>
          <span className={styles.scoreValue}>{d.correctCount}</span>
          <span className="text-body text-secondary"> из {d.plannedCount} верно</span>
        </p>
        <dl className={styles.scoreGrid}>
          <Stat
            label="Точность"
            value={d.accuracyPercent !== null ? `${d.accuracyPercent}%` : '—'}
          />
          <Stat label="Верно" value={String(d.correctCount)} tone="good" />
          <Stat label="Неверно" value={String(d.incorrectCount)} tone="bad" />
          {d.skippedCount > 0 && <Stat label="Пропущено" value={String(d.skippedCount)} />}
          {d.notReachedCount > 0 && <Stat label="Не решалось" value={String(d.notReachedCount)} />}
          {d.totalTimeMs !== null && (
            <Stat
              label={d.timedCount === answered ? 'Время' : `Время (${d.timedCount} из ${answered})`}
              value={formatDurationLong(d.totalTimeMs)}
            />
          )}
        </dl>
        {d.status === 'active' && (
          <Button
            onClick={() => navigate({ screen: 'learningSession', sessionId: d.sessionId })}
            fullWidth
          >
            Продолжить вариант
          </Button>
        )}
      </Card>

      {d.attribution === 'time_window' && (
        <p className={styles.note} role="note">
          <Icon name="info" size={16} /> Попытка из старой версии: ответы собраны по времени
          решения, поэтому сюда могли попасть ответы на те же задания из других тренировок.
        </p>
      )}

      {d.toRepeat.length > 0 && (
        <section className={styles.section} aria-labelledby="repeat-title">
          <h2 id="repeat-title" className={styles.sectionTitle}>
            Стоит повторить
          </h2>
          <ul className={styles.chips}>
            {d.toRepeat.map((t) => (
              <li key={t.taskId}>
                <button type="button" className={styles.chip} onClick={() => openTask(t)}>
                  <span className={styles.chipNumber}>№{t.taskNumber}</span>
                  {t.topic && <span className={styles.chipTopic}>{t.topic}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="numbers-title">
        <h2 id="numbers-title" className={styles.sectionTitle}>
          По номерам заданий
        </h2>
        <ul className={styles.numberGrid}>
          {d.byTaskNumber.map((g) => (
            <li key={g.key} className={styles.numberCell} data-tone={toneOf(g)}>
              <span className={styles.numberKey}>{g.key}</span>
              <span className={styles.numberScore}>
                {g.correct}/{g.total}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {d.byTopic.length > 0 && (
        <section className={styles.section} aria-labelledby="topics-title">
          <h2 id="topics-title" className={styles.sectionTitle}>
            По темам
          </h2>
          <ul className={styles.topics}>
            {d.byTopic.map((g) => (
              <li key={g.key} className={styles.topic}>
                <span className={styles.topicName}>{g.key}</span>
                <span className={styles.topicBar} aria-hidden="true">
                  <span style={{ width: `${(g.correct / g.total) * 100}%` }} />
                </span>
                <span className={styles.topicScore}>
                  {g.correct}/{g.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="tasks-title">
        <h2 id="tasks-title" className={styles.sectionTitle}>
          Задания и ответы
        </h2>
        <ol className={styles.tasks}>
          {d.tasks.map((task) => (
            <TaskRow
              key={task.taskId}
              task={task}
              open={open === task.taskId}
              onToggle={() => setOpen(open === task.taskId ? null : task.taskId)}
              onOpenTask={() => openTask(task)}
            />
          ))}
        </ol>
      </section>
    </SlideUp>
  );
}

function toneOf(g: VariantAttemptGroup): 'good' | 'mid' | 'bad' {
  if (g.correct === g.total) return 'good';
  return g.correct === 0 ? 'bad' : 'mid';
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={styles.stat}>
      <dt className="text-body-sm text-secondary">{label}</dt>
      <dd className={styles.statValue} data-tone={tone}>
        {value}
      </dd>
    </div>
  );
}

function TaskRow({
  task,
  open,
  onToggle,
  onOpenTask,
}: {
  task: VariantAttemptTask;
  open: boolean;
  onToggle: () => void;
  onOpenTask: () => void;
}) {
  const id = `attempt-task-${task.taskId}`;
  return (
    <li className={styles.task} data-outcome={task.outcome}>
      <button
        type="button"
        className={styles.taskHead}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className={styles.taskNumber}>№{task.taskNumber}</span>
        <span className={styles.taskMain}>
          <span className={clsx(styles.outcome)} data-outcome={task.outcome}>
            <Icon
              name={
                task.outcome === 'correct'
                  ? 'success'
                  : task.outcome === 'incorrect'
                    ? 'errorCircle'
                    : 'skip'
              }
              size={16}
            />
            {outcomeLabel[task.outcome]}
            {task.answers > 1 && ` · попыток: ${task.answers}`}
          </span>
          {task.topic && <span className={styles.taskTopic}>{task.topic}</span>}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      <Collapse open={open}>
        <div id={id} className={styles.taskBody}>
          <dl className={styles.answers}>
            <div>
              <dt className="text-body-sm text-secondary">Твой ответ</dt>
              <dd>{task.userAnswer ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-body-sm text-secondary">Правильный ответ</dt>
              <dd>
                <InlineMathText text={task.correctAnswer} />
              </dd>
            </div>
            {task.timeSpentMs !== null && (
              <div>
                <dt className="text-body-sm text-secondary">Время</dt>
                <dd>{formatDurationLong(task.timeSpentMs)}</dd>
              </div>
            )}
          </dl>
          {task.explanationMd.trim() && (
            <div className={styles.explanation}>
              <p className="text-body-sm text-secondary">Разбор</p>
              <MathText text={task.explanationMd} className="text-body-sm" />
            </div>
          )}
          <Button variant="secondary" onClick={onOpenTask}>
            Открыть задание
          </Button>
        </div>
      </Collapse>
    </li>
  );
}
