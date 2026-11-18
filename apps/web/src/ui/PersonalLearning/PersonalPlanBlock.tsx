import { useEffect, useState } from 'react';
import type { PersonalRecommendation, PersonalRecommendationsResponse } from '@zybrilka/shared';
import { getPersonalRecommendations } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import { Tabs } from '../Tabs/Tabs.js';
import { PLAN_SUBJECTS, isPlanSubject, usePlanSubject } from './planSubject.js';
import { SUBJECT_NAMES, daysWord, skillIcon, tasksWord, useStartSkillTraining } from './shared.js';
import styles from './PersonalLearning.module.css';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: PersonalRecommendationsResponse };

const PRIORITY_LABEL = { high: 'высокий', medium: 'средний', low: 'низкий' } as const;
const SEGMENTS = 7;

/** Loads `/me/learning/personal`; `key` changes reload it. */
export function usePersonalRecommendations(subjectId: string | undefined, limit: number) {
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const key = `${subjectId ?? 'all'}|${limit}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const state: State = result && result.key === key ? result.state : { status: 'loading' };
  useEffect(() => {
    if (!user) return;
    let live = true;
    getPersonalRecommendations({ subjectId, limit }).then(
      (data) => live && setResult({ key, state: { status: 'ready', data } }),
      () => live && setResult({ key, state: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [user, key, subjectId, limit]);
  return { user, state, retry: () => setAttempt((n) => n + 1) };
}

/** Mastery as segments; «мало данных» never draws a fake bar. */
export function MasteryBar({ mastery, tone }: { mastery: number | null; tone: string }) {
  if (mastery === null) {
    return <span className={styles.lowData}>мало данных</span>;
  }
  const filled = Math.max(mastery > 0 ? 1 : 0, Math.round((mastery / 100) * SEGMENTS));
  return (
    <span
      className={styles.segments}
      role="img"
      aria-label={`Освоение ${mastery}%`}
      data-tone={tone}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={clsx(styles.segment, i < filled && styles.segmentOn)} />
      ))}
    </span>
  );
}

function RecommendationCard({
  r,
  starting,
  onStart,
  compact = false,
}: {
  r: PersonalRecommendation;
  starting: string | null;
  onStart: (r: PersonalRecommendation) => void;
  compact?: boolean;
}) {
  const { navigate } = useNavigation();
  return (
    <li className={styles.rec} data-priority={r.priorityLevel} data-compact={compact || undefined}>
      <span className={styles.recIcon} aria-hidden="true">
        <Icon name={skillIcon(r.skillKey)} size={compact ? 20 : 26} />
      </span>
      <div className={styles.recBody}>
        <p className={styles.recTitle}>{r.title}</p>
        <p className={styles.recMeta}>
          {SUBJECT_NAMES[r.subjectId] ?? r.subjectId}
          {r.examNumber ? <> · №{r.examNumber}</> : null}
        </p>
        <p className={styles.recProblem}>
          <span className={styles.problemName}>{r.problem.title}.</span>{' '}
          {!compact && r.problem.summary}
        </p>
      </div>
      <div className={styles.recSide}>
        <span className={styles.priority} data-priority={r.priorityLevel}>
          Приоритет: {PRIORITY_LABEL[r.priorityLevel]}
        </span>
        <MasteryBar
          mastery={r.progress.mastery}
          tone={
            r.priorityLevel === 'high' ? 'red' : r.priorityLevel === 'medium' ? 'amber' : 'blue'
          }
        />
      </div>
      <div className={styles.recActions}>
        <Button
          variant="secondary"
          className={styles.startButton}
          loading={starting === r.skillKey}
          disabled={starting !== null}
          onClick={() => onStart(r)}
          aria-label={`Начать: ${r.title}, ${tasksWord(Math.min(10, Math.max(r.suggestedTasks, r.taskIds.length)))}`}
        >
          Начать <Icon name="arrowRight" size={16} />
        </Button>
        {!compact && (
          <Button
            variant="ghost"
            onClick={() => navigate({ screen: 'skillAdvice', skillKey: r.skillKey })}
            aria-label={`Подробный совет: ${r.title}`}
          >
            Подробнее
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * «Твой персональный план» (docs/learning/PERSONAL-PLANS.md): the header
 * numbers, then the recommendations — each with the diagnosed problem, its
 * priority and progress, «Начать» and «Подробнее». Everything comes from the
 * server; an empty or failed load says so.
 *
 * Always ONE subject: the `subjectId` given by the screen, or else the
 * student's choice in the block's own switcher (remembered across screens,
 * `usePlanSubject`). Numbers of two subjects are never mixed.
 */
export function PersonalPlanBlock({
  subjectId: fixedSubject,
  limit = 4,
  showAllLink = false,
}: {
  subjectId?: 'math' | 'russian';
  limit?: number;
  showAllLink?: boolean;
}) {
  const { navigate } = useNavigation();
  const [chosen, choose] = usePlanSubject();
  const subjectId = fixedSubject ?? chosen;
  const { user, state, retry } = usePersonalRecommendations(subjectId, limit);
  const { start, starting, failed } = useStartSkillTraining();

  if (user === null) {
    return (
      <section className={styles.block} aria-label="Персональный план">
        <h2 className={styles.blockTitle}>Твой персональный план</h2>
        <p className={styles.blockLead}>
          Войди, чтобы получать план по своим ошибкам и слабым номерам.
        </p>
      </section>
    );
  }
  const header = (
    <header className={styles.blockHead}>
      <h2 className={styles.blockTitle}>Твой персональный план</h2>
      <p className={styles.blockLead}>Составлен по твоим ответам — без догадок</p>
      {!fixedSubject && (
        <Tabs
          aria-label="Предмет плана"
          className={styles.subjectSwitch}
          items={PLAN_SUBJECTS}
          activeId={subjectId}
          onChange={(id) => isPlanSubject(id) && choose(id)}
        />
      )}
    </header>
  );
  if (user === undefined || state.status === 'loading') {
    return (
      <section className={styles.block} aria-busy="true" aria-label="Персональный план загружается">
        {header}
        <Skeleton height={72} />
        <Skeleton height={96} />
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className={styles.block} role="alert">
        {header}
        <p className={styles.blockLead}>Не удалось загрузить рекомендации.</p>
        <Button variant="secondary" onClick={retry}>
          Повторить
        </Button>
      </section>
    );
  }
  const { summary, recommendations } = state.data;
  const planSubject = subjectId;
  return (
    <section className={styles.block} aria-label="Персональный план">
      {header}
      <ul className={styles.stats} aria-label="Сводка">
        <li className={styles.stat}>
          <span className={styles.statHead}>
            <span className={styles.statIcon} aria-hidden="true">
              <Icon name="target" size={18} />
            </span>
            <span className={styles.statLabel}>В фокусе</span>
          </span>
          <span className={styles.statMain}>
            <span className={styles.statValue}>{summary.priorityTopics}</span>
            <span className={styles.statUnit}>приоритетных тем</span>
          </span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statHead}>
            <span className={styles.statIcon} aria-hidden="true">
              <Icon name="trend" size={18} />
            </span>
            <span className={styles.statLabel}>Можно поднять</span>
          </span>
          {/* The ЕГЭ gain is shown in TEST points only, with its table;
              primary points never stand in for it. */}
          {summary.potentialTestPoints.available ? (
            <>
              <span className={styles.statMain}>
                {summary.potentialTestPoints.points > 0 &&
                  summary.potentialTestPoints.approximate && (
                    <span className={styles.statUnit}>≈</span>
                  )}
                <span className={styles.statValue}>
                  {summary.potentialTestPoints.points > 0
                    ? `+${summary.potentialTestPoints.points}`
                    : '0'}
                </span>
                <span className={styles.statUnit}>тестовых баллов</span>
              </span>
              <span
                className={styles.statShift}
                aria-label={`было ${summary.potentialTestPoints.from}, станет ${summary.potentialTestPoints.to}`}
              >
                {summary.potentialTestPoints.from} → <b>{summary.potentialTestPoints.to}</b>
              </span>
              <details className={styles.statMore}>
                <summary>Как считали</summary>
                <p>
                  До +{summary.potentialTestPoints.points} по этим темам, если их освоить.{' '}
                  {summary.potentialTestPoints.label}
                  {summary.potentialTestPoints.note ? `. ${summary.potentialTestPoints.note}` : ''}
                </p>
              </details>
            </>
          ) : (
            <>
              <span className={styles.statMain}>
                <span className={styles.statValue}>—</span>
                <span className={styles.statUnit}>не рассчитывается</span>
              </span>
              <details className={styles.statMore}>
                <summary>Почему</summary>
                <p>{summary.potentialTestPoints.reason}</p>
              </details>
            </>
          )}
        </li>
        <li className={styles.stat}>
          <span className={styles.statHead}>
            <span className={styles.statIcon} aria-hidden="true">
              <Icon name="calendar" size={18} />
            </span>
            <span className={styles.statLabel}>
              {summary.etaBasis === 'active_plan'
                ? 'До конца плана'
                : summary.etaBasis === 'week_plan'
                  ? 'До цели в недельном темпе'
                  : 'Срок'}
            </span>
          </span>
          <span className={styles.statMain}>
            {summary.etaDays === null ? (
              <>
                <span className={styles.statValue}>—</span>
                <span className={styles.statUnit}>появится с данными</span>
              </>
            ) : (
              <>
                <span className={styles.statUnit}>≈</span>
                <span className={styles.statValue}>{summary.etaDays}</span>
                <span className={styles.statUnit}>
                  {daysWord(summary.etaDays).replace(/^\d+ /, '')}
                </span>
              </>
            )}
          </span>
        </li>
      </ul>

      {recommendations.length === 0 ? (
        <p className={styles.blockLead} role="status">
          Пока нечего рекомендовать: реши несколько заданий — и здесь появится план.
        </p>
      ) : (
        <ul className={styles.recList} aria-label="Рекомендации">
          {recommendations.map((r) => (
            <RecommendationCard
              key={r.skillKey}
              r={r}
              starting={starting}
              onStart={(x) =>
                void start({
                  key: x.skillKey,
                  subjectId: x.subjectId,
                  skillKey: x.skillKey,
                  tasks: Math.max(x.suggestedTasks, x.taskIds.length),
                })
              }
            />
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className={styles.error}>
          Не удалось начать тренировку. Попробуй ещё раз.
        </p>
      )}

      <footer className={styles.blockFoot}>
        {summary.activePlan ? (
          <>
            <span className={styles.planLine}>
              План на {summary.activePlan.kind === 'week' ? '7 дней' : '30 дней'} выполнен на{' '}
              <b>{summary.activePlan.percent}%</b>
              {summary.activePlan.today
                ? ` · сегодня: ${summary.activePlan.today.activityTitle.toLowerCase()}`
                : ''}
            </span>
            <Button
              variant="secondary"
              onClick={() =>
                navigate({
                  screen: 'learningPlan',
                  subjectId: summary.activePlan!.subjectId as 'math' | 'russian',
                })
              }
            >
              Открыть план
            </Button>
          </>
        ) : (
          recommendations.length > 0 && (
            <>
              <span className={styles.planLine}>Составь план по этим темам:</span>
              <Button
                variant="secondary"
                onClick={() =>
                  navigate({ screen: 'learningPlan', subjectId: planSubject as 'math' | 'russian' })
                }
              >
                План на 7 или 30 дней
              </Button>
            </>
          )
        )}
        {showAllLink && (
          <Button
            variant="ghost"
            onClick={() => navigate({ screen: 'recommendations', subjectId })}
          >
            Все рекомендации
          </Button>
        )}
      </footer>
    </section>
  );
}

/**
 * Mobile home: the one or two most urgent recommendations, the plan's
 * progress and «Все рекомендации» — under «Продолжить».
 */
export function HomeRecommendations() {
  const { navigate } = useNavigation();
  const [subjectId] = usePlanSubject();
  const { user, state } = usePersonalRecommendations(subjectId, 2);
  const { start, starting } = useStartSkillTraining();
  if (!user) return null;
  return (
    <section className={styles.home} aria-label="Рекомендации">
      <div className={styles.homeHead}>
        <p className="text-h3">Рекомендации</p>
        <button
          type="button"
          className={styles.homeLink}
          onClick={() => navigate({ screen: 'recommendations', subjectId })}
        >
          Все рекомендации <Icon name="chevronRight" size={16} />
        </button>
      </div>
      {state.status === 'loading' ? (
        <Skeleton height={84} />
      ) : state.status === 'error' ? (
        <p className="text-body-sm text-secondary">Не удалось загрузить рекомендации.</p>
      ) : state.data.recommendations.length === 0 ? (
        <p className="text-body-sm text-secondary">
          Реши несколько заданий — и здесь появятся темы для прокачки.
        </p>
      ) : (
        <>
          {state.data.summary.activePlan && (
            <button
              type="button"
              className={styles.homePlan}
              onClick={() =>
                navigate({
                  screen: 'learningPlan',
                  subjectId: state.data.summary.activePlan!.subjectId as 'math' | 'russian',
                })
              }
            >
              <span>План на {state.data.summary.activePlan.kind === 'week' ? '7' : '30'} дней</span>
              <span className={styles.homePlanBar} aria-hidden="true">
                <span style={{ width: `${state.data.summary.activePlan.percent}%` }} />
              </span>
              <b>{state.data.summary.activePlan.percent}%</b>
            </button>
          )}
          <ul className={styles.recList}>
            {state.data.recommendations.slice(0, 2).map((r) => (
              <RecommendationCard
                key={r.skillKey}
                r={r}
                compact
                starting={starting}
                onStart={(x) =>
                  void start({
                    key: x.skillKey,
                    subjectId: x.subjectId,
                    skillKey: x.skillKey,
                    tasks: Math.max(x.suggestedTasks, x.taskIds.length),
                  })
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
