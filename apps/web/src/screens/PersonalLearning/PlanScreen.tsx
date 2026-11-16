import { useState } from 'react';
import type { PlanDayView, PlanResponse } from '@zybrilka/shared';
import {
  cancelLearningPlan,
  changePlanDay,
  createLearningPlan,
  getCurrentPlan,
} from '../../lib/api.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../../ui/Button/Button.js';
import { LEARNING_CENTER_CRUMB, LearningNav } from '../../ui/LearningNav/LearningNav.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import {
  SUBJECT_NAMES,
  dayLabel,
  tasksWord,
  useStartSkillTraining,
} from '../../ui/PersonalLearning/shared.js';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';
import { useLoad } from './useLoad.js';

const STATUS: Record<PlanDayView['status'], string> = {
  done: 'Выполнено',
  partial: 'Начато',
  pending: 'Впереди',
  missed: 'Пропущено',
  skipped: 'Пропущено тобой',
  rest: 'Отдых',
};

const DIFFICULTY = ['', 'базовый', 'средний', 'сложный'];

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className={styles.muted}>мало новых ответов</span>;
  return (
    <span className={value > 0 ? styles.up : value < 0 ? styles.down : undefined}>
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  );
}

/**
 * The personal 7/30-day plan of a subject: choose a plan, see every day with
 * what was really done, start today's training, skip or move a day, and
 * compare with the starting point.
 */
export function PlanScreen({ subjectId }: { subjectId: 'math' | 'russian' }) {
  const { navigate } = useNavigation();
  const { state, reload, set } = useLoad(`plan|${subjectId}`, () => getCurrentPlan(subjectId));
  const { start, starting, failed } = useStartSkillTraining();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function act(key: string, work: () => Promise<{ plan: PlanResponse | null }>) {
    setBusy(key);
    setProblem(null);
    try {
      set(await work());
    } catch (error) {
      const status = (error as { status?: number }).status;
      setProblem(
        status === 422
          ? 'Пока не из чего составить план: реши несколько заданий этого предмета.'
          : status === 409
            ? 'Это действие сейчас недоступно.'
            : 'Не получилось. Попробуй ещё раз.',
      );
    } finally {
      setBusy(null);
    }
  }

  const nav = (
    <>
      <LearningNav
        trail={[
          LEARNING_CENTER_CRUMB,
          { label: 'Рекомендации', route: { screen: 'recommendations' } },
          { label: 'План подготовки' },
        ]}
      />
      <Tabs
        aria-label="Предмет"
        items={[
          { id: 'math', label: 'Математика' },
          { id: 'russian', label: 'Русский язык' },
        ]}
        activeId={subjectId}
        onChange={(id) =>
          navigate(
            { screen: 'learningPlan', subjectId: id as 'math' | 'russian' },
            { replace: true },
          )
        }
      />
    </>
  );

  if (state.status === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {nav}
        <Skeleton height={120} />
        <Skeleton height={300} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={styles.screen} role="alert">
        {nav}
        <p>Не удалось загрузить план.</p>
        <Button variant="secondary" onClick={reload}>
          Повторить
        </Button>
      </div>
    );
  }

  const plan = state.data.plan;
  const chooser = (replace: boolean) => (
    <section className={styles.card} aria-labelledby="plan-choose">
      <h2 id="plan-choose" className="text-h3">
        {replace ? 'Новый план' : `Составим план по предмету «${SUBJECT_NAMES[subjectId]}»`}
      </h2>
      <p className={styles.muted}>
        План строится по твоим ответам: слабые номера, причины ошибок и число заданий, которые есть
        в базе. Не больше 8 заданий в день.
      </p>
      <div className={styles.kinds}>
        {(['week', 'month'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={styles.kind}
            disabled={busy !== null}
            aria-busy={busy === kind || undefined}
            onClick={() => void act(kind, () => createLearningPlan({ subjectId, kind, replace }))}
          >
            <b>{kind === 'week' ? 'План на 7 дней' : 'План на 30 дней'}</b>
            <span className={styles.muted}>
              {kind === 'week'
                ? 'Один самый важный номер: теория, тренировка, разбор ошибок, контроль.'
                : 'До трёх номеров по очереди, день отдыха каждую неделю, контроль в конце.'}
            </span>
          </button>
        ))}
      </div>
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
    </section>
  );

  if (!plan) {
    return (
      <div className={styles.screen}>
        {nav}
        {chooser(false)}
      </div>
    );
  }

  const today = plan.days.find((d) => d.date === plan.today && d.activity !== 'rest');
  return (
    <div className={styles.screen}>
      {nav}
      <section className={styles.card} aria-labelledby="plan-title">
        <p className={styles.muted}>
          {dayLabel(plan.startDate)} — {dayLabel(plan.endDate)}
          {plan.status === 'completed' ? ' · завершён' : ''}
        </p>
        <h1 id="plan-title" className="text-h1" style={{ margin: 0 }}>
          {plan.kind === 'week' ? 'План на 7 дней' : 'План на 30 дней'}
        </h1>
        <div
          className={styles.progressBar}
          role="progressbar"
          aria-valuenow={plan.progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Выполнение плана"
        >
          <span style={{ width: `${plan.progress.percent}%` }} />
        </div>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{plan.progress.percent}%</span>
            <span className={styles.muted}>
              дней выполнено: {plan.progress.daysDone} из {plan.progress.daysTotal}
            </span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{plan.progress.tasksDone}</span>
            <span className={styles.muted}>заданий решено по плану</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{plan.progress.tasksLeft}</span>
            <span className={styles.muted}>заданий осталось</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {plan.progress.daysSkipped + plan.progress.daysMissed}
            </span>
            <span className={styles.muted}>дней пропущено (не засчитаны)</span>
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="plan-focus">
        <h2 id="plan-focus" className="text-h3">
          Было → стало
        </h2>
        {plan.focus.map((f) => (
          <div key={f.skillKey} className={styles.compare}>
            <div>
              <b>
                {f.examNumber ? `№${f.examNumber}` : ''} {f.title}
              </b>
              <p className={styles.muted}>Ответов по плану: {f.now.attemptsInPlan}</p>
            </div>
            <div>
              <span className={styles.muted}>Освоение до плана</span>
              <div className={styles.tileValue}>{f.before.mastery}%</div>
            </div>
            <div>
              <span className={styles.muted}>Сейчас</span>
              <div className={styles.tileValue}>
                {f.now.mastery === null ? '—' : `${f.now.mastery}%`}
              </div>
            </div>
            <div>
              <span className={styles.muted}>Точность</span>
              <div className={styles.tileValue}>
                <Delta value={f.accuracyDelta} />
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={() => navigate({ screen: 'skillProgress', skillKey: f.skillKey })}
            >
              Прогресс по номеру
            </Button>
          </div>
        ))}
      </section>

      {failed && (
        <p role="alert" className={styles.error}>
          Не удалось начать тренировку.
        </p>
      )}
      {problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}

      <section aria-labelledby="plan-days">
        <h2 id="plan-days" className="text-h3">
          Дни плана
        </h2>
        <ol className={styles.days}>
          {plan.days.map((d) => {
            const left = Math.max(0, d.targetTasks - d.done);
            return (
              <li key={d.dayIndex} className={styles.day} data-today={d === today || undefined}>
                <div className={styles.dayHead}>
                  <b>
                    День {d.dayIndex + 1} · {dayLabel(d.date)}
                    {d.date === plan.today ? ' · сегодня' : ''}
                  </b>
                  <span className={styles.chip} data-status={d.status}>
                    {STATUS[d.status]}
                  </span>
                </div>
                <p style={{ margin: 0 }}>
                  {d.activityTitle}
                  {d.examNumber ? ` · №${d.examNumber} ${d.skillTitle ?? ''}` : ''}
                </p>
                {d.activity !== 'rest' && (
                  <>
                    <ul className={styles.list}>
                      {d.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                    <p className={styles.muted}>
                      Решено {d.done} из {d.targetTasks} · уровень: {DIFFICULTY[d.difficulty]}
                    </p>
                  </>
                )}
                {plan.status === 'active' && (d.canSkip || d.canMove) && (
                  <div className={styles.actions}>
                    {d.skillKey && left > 0 && d.date === plan.today && (
                      <Button
                        loading={starting === `day${d.dayIndex}`}
                        disabled={starting !== null}
                        onClick={() =>
                          void start({
                            key: `day${d.dayIndex}`,
                            subjectId,
                            skillKey: d.skillKey!,
                            tasks: left,
                            difficulty: d.difficulty,
                          })
                        }
                      >
                        Начать · {tasksWord(left)}
                      </Button>
                    )}
                    {d.canMove && (
                      <Button
                        variant="secondary"
                        loading={busy === `move${d.dayIndex}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`move${d.dayIndex}`, () =>
                            changePlanDay(plan.id, d.dayIndex, 'move'),
                          )
                        }
                      >
                        Перенести на завтра
                      </Button>
                    )}
                    {d.canSkip && (
                      <Button
                        variant="ghost"
                        loading={busy === `skip${d.dayIndex}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`skip${d.dayIndex}`, () =>
                            changePlanDay(plan.id, d.dayIndex, 'skip'),
                          )
                        }
                      >
                        Пропустить
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className={styles.muted}>Переносов осталось: {plan.movesLeft}</p>
      </section>

      {plan.status === 'active' ? (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              void act('cancel', async () => {
                await cancelLearningPlan(plan.id);
                return { plan: null };
              })
            }
          >
            Отменить план
          </Button>
        </div>
      ) : (
        chooser(true)
      )}
    </div>
  );
}
