import { examSkillInfo } from '@zybrilka/shared';
import { getSkillAdvice } from '../../lib/api.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../../ui/Button/Button.js';
import { LEARNING_CENTER_CRUMB, LearningNav } from '../../ui/LearningNav/LearningNav.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import {
  useStartSkillTraining,
  tasksWord,
  SUBJECT_NAMES,
} from '../../ui/PersonalLearning/shared.js';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';
import { useLoad } from './useLoad.js';

const DIFFICULTY = { easy: 1, mixed: undefined, hard: 3 } as const;

/**
 * «Подробнее» of a recommendation: the problem with the student's numbers,
 * why it happens, what to review (with the theory page), the fixing steps,
 * the practice and the control check, and the current stats.
 */
export function AdviceScreen({ skillKey }: { skillKey: string }) {
  const { navigate } = useNavigation();
  const { state, reload } = useLoad(`advice|${skillKey}`, () => getSkillAdvice(skillKey));
  const { start, starting, failed } = useStartSkillTraining();
  const info = examSkillInfo(skillKey);
  const nav = (
    <LearningNav
      trail={[
        LEARNING_CENTER_CRUMB,
        { label: 'Рекомендации', route: { screen: 'recommendations' } },
        { label: info?.examNumber ? `№${info.examNumber}` : (info?.title ?? 'Совет') },
      ]}
    />
  );
  if (state.status === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {nav}
        <Skeleton height={140} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={styles.screen} role="alert">
        {nav}
        <p>{state.notFound ? 'Такого номера нет.' : 'Не удалось загрузить совет.'}</p>
        {!state.notFound && (
          <Button variant="secondary" onClick={reload}>
            Повторить
          </Button>
        )}
      </div>
    );
  }
  const a = state.data;
  const tasks = Math.min(10, a.advice.practice.tasks);
  return (
    <div className={styles.screen}>
      {nav}
      <header className={styles.card}>
        <p className={styles.muted}>
          {SUBJECT_NAMES[a.subjectId]} {a.examNumber ? `· №${a.examNumber}` : ''} · {a.title}
        </p>
        <h1 className="text-h1" style={{ margin: 0 }}>
          {a.problem.title}
        </h1>
        <p style={{ margin: 0 }}>{a.advice.whatIsWrong}</p>
        <ul className={styles.list} aria-label="По твоим ответам">
          {a.problem.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <div className={styles.actions}>
          <Button
            loading={starting === skillKey}
            disabled={starting !== null || a.availableTasks === 0}
            onClick={() =>
              void start({
                key: skillKey,
                subjectId: a.subjectId,
                skillKey,
                tasks,
                difficulty: DIFFICULTY[a.advice.practice.difficulty],
              })
            }
          >
            Начать тренировку · {tasksWord(tasks)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate({ screen: 'skillProgress', skillKey })}
          >
            Прогресс по номеру
          </Button>
        </div>
        {failed && (
          <p role="alert" className={styles.error}>
            Не удалось начать тренировку.
          </p>
        )}
      </header>

      <section className={styles.card} aria-labelledby="advice-why">
        <h2 id="advice-why" className="text-h3">
          Почему так бывает
        </h2>
        <p style={{ margin: 0 }}>{a.advice.why}</p>
      </section>

      <section className={styles.card} aria-labelledby="advice-review">
        <h2 id="advice-review" className="text-h3">
          Что повторить
        </h2>
        <ul className={styles.list}>
          {a.advice.review.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {a.theory && (
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                navigate({
                  screen: 'theory',
                  section: 'rules',
                  taskNumber: a.theory!.taskNumber,
                  ...(a.theory!.subjectId === 'math' ? { subject: 'math' as const } : {}),
                })
              }
            >
              Открыть теорию №{a.theory.taskNumber}
            </Button>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="advice-steps">
        <h2 id="advice-steps" className="text-h3">
          План действий
        </h2>
        <ol className={styles.list}>
          {a.advice.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className={styles.muted}>
          Рекомендуемая практика: {tasksWord(a.advice.practice.tasks)}. Контроль:{' '}
          {tasksWord(a.advice.control.tasks)}, цель — не меньше {a.advice.control.passAccuracy}%
          верных.
        </p>
        {a.advice.generic && (
          <p className={styles.note}>
            Это общий совет для такого типа ошибок: точного совета именно для этого номера в базе
            пока нет.
          </p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="advice-stats">
        <h2 id="advice-stats" className="text-h3">
          Твоя статистика по номеру
        </h2>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {a.stats.mastery === null ? 'мало данных' : `${a.stats.mastery}%`}
            </span>
            <span className={styles.muted}>освоение</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{a.stats.solvedTasks}</span>
            <span className={styles.muted}>решено заданий</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {a.stats.accuracy === null ? '—' : `${a.stats.accuracy}%`}
            </span>
            <span className={styles.muted}>верных ответов</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{a.stats.repeatedErrorTasks}</span>
            <span className={styles.muted}>повторных ошибок</span>
          </div>
        </div>
      </section>
    </div>
  );
}
