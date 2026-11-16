import { examSkillInfo } from '@zybrilka/shared';
import { getSkillProgress } from '../../lib/api.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../../ui/Button/Button.js';
import { LEARNING_CENTER_CRUMB, LearningNav } from '../../ui/LearningNav/LearningNav.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import {
  SUBJECT_NAMES,
  dayLabel,
  useStartSkillTraining,
} from '../../ui/PersonalLearning/shared.js';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';
import { AccuracyChart } from './AccuracyChart.js';
import { useLoad } from './useLoad.js';

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className={styles.muted}>мало данных для сравнения</span>;
  return (
    <span className={value > 0 ? styles.up : value < 0 ? styles.down : undefined}>
      {value > 0 ? '+' : ''}
      {value} п.п.
    </span>
  );
}

const LEVEL = {
  none: 'не решал',
  low_data: 'мало данных',
  weak: 'слабо',
  developing: 'в процессе',
  strong: 'уверенно',
} as const;

/**
 * Progress of one EGE number: mastery (never a percentage on too little
 * data), solved, accuracy, errors, 7/30-day dynamics, the accuracy chart,
 * the goal, the plan before/after and the practice history.
 */
export function SkillProgressScreen({ skillKey }: { skillKey: string }) {
  const { navigate } = useNavigation();
  const { state, reload } = useLoad(`progress|${skillKey}`, () => getSkillProgress(skillKey));
  const { start, starting } = useStartSkillTraining();
  const info = examSkillInfo(skillKey);
  const nav = (
    <LearningNav
      trail={[
        LEARNING_CENTER_CRUMB,
        { label: 'Рекомендации', route: { screen: 'recommendations' } },
        { label: info?.examNumber ? `Прогресс №${info.examNumber}` : 'Прогресс' },
      ]}
    />
  );
  if (state.status === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {nav}
        <Skeleton height={120} />
        <Skeleton height={200} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={styles.screen} role="alert">
        {nav}
        <p>{state.notFound ? 'Такого номера нет.' : 'Не удалось загрузить прогресс.'}</p>
        {!state.notFound && (
          <Button variant="secondary" onClick={reload}>
            Повторить
          </Button>
        )}
      </div>
    );
  }
  const p = state.data;
  return (
    <div className={styles.screen}>
      {nav}
      <header className={styles.card}>
        <p className={styles.muted}>
          {SUBJECT_NAMES[p.subjectId]} {p.examNumber ? `· №${p.examNumber}` : ''}
        </p>
        <h1 className="text-h1" style={{ margin: 0 }}>
          {p.title}
        </h1>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {p.stats.mastery === null ? LEVEL[p.stats.level] : `${p.stats.mastery}%`}
            </span>
            <span className={styles.muted}>
              освоение{p.stats.mastery !== null ? ` · ${LEVEL[p.stats.level]}` : ''}
            </span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{p.stats.solvedTasks}</span>
            <span className={styles.muted}>решено заданий</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>
              {p.stats.accuracy === null ? '—' : `${p.stats.accuracy}%`}
            </span>
            <span className={styles.muted}>верных из {p.stats.attempts} ответов</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{p.stats.incorrect}</span>
            <span className={styles.muted}>ошибок · повторных: {p.stats.repeatedErrorTasks}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            loading={starting === skillKey}
            disabled={starting !== null}
            onClick={() =>
              void start({ key: skillKey, subjectId: p.subjectId, skillKey, tasks: 5 })
            }
          >
            Тренировать этот номер
          </Button>
          <Button variant="secondary" onClick={() => navigate({ screen: 'skillAdvice', skillKey })}>
            Совет: {p.problem.title.toLowerCase()}
          </Button>
        </div>
      </header>

      <section className={styles.card} aria-labelledby="dyn">
        <h2 id="dyn" className="text-h3">
          Динамика точности
        </h2>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.muted}>7 дней</span>
            <span className={styles.tileValue}>
              {p.dynamics.last7.accuracy === null ? '—' : `${p.dynamics.last7.accuracy}%`}
            </span>
            <Delta value={p.dynamics.delta7} />
          </div>
          <div className={styles.tile}>
            <span className={styles.muted}>30 дней</span>
            <span className={styles.tileValue}>
              {p.dynamics.last30.accuracy === null ? '—' : `${p.dynamics.last30.accuracy}%`}
            </span>
            <Delta value={p.dynamics.delta30} />
          </div>
        </div>
        <AccuracyChart series={p.series} />
        <p className={styles.muted}>
          Линия — точность за последние 7 дней, столбики — сколько ответов в день.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="goal">
        <h2 id="goal" className="text-h3">
          Цель
        </h2>
        {p.goal && (
          <p style={{ margin: 0 }}>
            Ближайшая цель — освоение {p.goal.targetMastery}%
            {p.stats.mastery !== null ? ` (сейчас ${p.stats.mastery}%)` : ''}.
          </p>
        )}
        {p.plan ? (
          <>
            <p className={styles.muted}>
              По плану: дней выполнено {p.planProgress?.done ?? 0} из {p.planProgress?.total ?? 0}.
              До плана — {p.plan.before.mastery}%
              {p.plan.before.accuracy !== null ? `, точность ${p.plan.before.accuracy}%` : ''}.
            </p>
            {p.plan.enoughData ? (
              <p style={{ margin: 0 }}>
                Изменение с начала плана: освоение <Delta value={p.plan.masteryDelta} />, точность{' '}
                <Delta value={p.plan.accuracyDelta} />.
              </p>
            ) : (
              <p className={styles.muted}>
                Чтобы сравнить с началом плана, нужно хотя бы 5 ответов по плану.
              </p>
            )}
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={() =>
              navigate({ screen: 'learningPlan', subjectId: p.subjectId as 'math' | 'russian' })
            }
          >
            Составить план
          </Button>
        )}
      </section>

      <section className={styles.card} aria-labelledby="hist">
        <h2 id="hist" className="text-h3">
          История тренировок
        </h2>
        {p.history.length === 0 ? (
          <p className={styles.muted}>Ты ещё не решал этот номер.</p>
        ) : (
          <ul className={styles.history}>
            {p.history.map((h) => (
              <li key={h.date}>
                <span>{dayLabel(h.date)}</span>
                <span>
                  {h.correct} из {h.attempts} верно
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
