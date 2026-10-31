import { AnimatedNumber } from '../../ui/AnimatedNumber/AnimatedNumber.js';
import { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { registerPrivateCacheReset } from '../../lib/privateCaches.js';
import { subjects } from '../../data/subjects.js';
import { startRealTask } from '../../lib/startTraining.js';
import { computeMistakesSummary, type Mistake } from '../../data/sampleMistakes.js';
import {
  getMistakes,
  getProgressByTaskNumber,
  getProgressByTopic,
  getProgressSummary,
  getTaskNumberStatisticsDetail,
  getVariantProgress,
} from '../../lib/api.js';
import { toSampleMistake } from '../../lib/mistakeAdapter.js';
import { toTaskNumberProgress } from '../../lib/progressAdapter.js';
import { useTaskCountsBySubject } from '../../lib/useTaskCounts.js';
import type {
  ProgressByTopicResponse,
  ProgressSummary,
  TaskNumberStatisticsDetail,
  VariantProgressItem,
} from '@zybrilka/shared';
import { Card } from '../../ui/Card/Card.js';
import { VariantHistoryCard } from '../../ui/Statistics/VariantHistoryCard.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { RatingBoard } from '../Rating/RatingBoard.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectHeaderMobile } from '../../ui/SubjectHeader/SubjectHeaderMobile.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { StatTile } from '../../ui/Statistics/StatTile.js';
import { TaskNumberBars } from '../../ui/Statistics/TaskNumberBars.js';
import { TaskNumberGrid } from '../../ui/Statistics/TaskNumberGrid.js';
import { TaskNumberDetailPanel } from '../../ui/Statistics/TaskNumberDetailPanel.js';
import { TopicProgressRow } from '../../ui/Statistics/TopicProgressRow.js';
import { WipPlaceholder } from '../../ui/WipPlaceholder/WipPlaceholder.js';
import { CircularProgress } from '../../ui/Progress/CircularProgress.js';
import { DonutChart } from '../../ui/Charts/DonutChart.js';
import { FadeIn } from '../../ui/motion/motion.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { SubjectPickerDialog } from '../../ui/SubjectPicker/SubjectPicker.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { ActivityCharts } from '../../ui/Statistics/ActivityCharts.js';
import styles from './StatisticsMobile.module.css';

const subTabs = [
  { id: 'overview', label: 'Общая' },
  { id: 'byTask', label: 'По заданиям' },
  { id: 'byTopic', label: 'По темам' },
  { id: 'exams', label: 'Пробники' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'rating', label: 'Рейтинг' },
];

const DEFAULT_SUBJECT_ID = 'math';

/** The sub-tab last open in this visit: coming back to Статистика (e.g.
 * from a task or the rating) returns to it instead of «Общая». */
let lastSubTab = 'overview';
registerPrivateCacheReset(() => {
  lastSubTab = 'overview';
});

/**
 * Mobile Statistics (S1 Block 6, approved design —
 * mobile/07_statistics.png): the "Общая" sub-tab reproduces the
 * approved composition in full. The other three sub-tabs are real,
 * switchable tabs with no approved screenshot yet, so — per the same
 * rule already applied to desktop "Учебный центр"/"Меню" — they show
 * the neutral WIP placeholder rather than an invented layout.
 *
 * Every number here is real (Block D): task-number/topic X/Y from the
 * same by-task-number/by-topic endpoints Subject uses, the errors
 * donut from the real `/mistakes` feed. Level/XP/streak/average-time
 * and mock exams have no backend metric behind them at all — they show
 * a neutral "—"/empty state rather than fabricated numbers.
 */
export function StatisticsMobile() {
  const { navigate } = useNavigation();
  const [subTab, setSubTabState] = useState(lastSubTab);
  const setSubTab = (id: string) => {
    lastSubTab = id;
    setSubTabState(id);
  };
  const [subjectId, setSubjectId] = useState(DEFAULT_SUBJECT_ID);
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]!;
  const [realProgress, setRealProgress] = useState<ProgressSummary | null>(null);
  const allSourcesCounts = useTaskCountsBySubject();
  // Per-subject data is stored WITH the subject it belongs to: right after
  // a subject switch the previous subject's numbers must never be shown
  // under the new subject's name (they used to, until the new response
  // landed) — until then the screen shows its loading state instead.
  const [taskNumberData, setTaskNumberData] = useState<{
    subjectId: string;
    items: Awaited<ReturnType<typeof getProgressByTaskNumber>>['items'];
  } | null>(null);
  const [topicData, setTopicData] = useState<{
    subjectId: string;
    items: ProgressByTopicResponse['items'];
  } | null>(null);
  const [mistakes, setMistakes] = useState<readonly Mistake[]>([]);
  const [selectedTaskNumber, setSelectedTaskNumber] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskNumberStatisticsDetail | null | undefined>(undefined);
  const [variantHistory, setVariantHistory] = useState<readonly VariantProgressItem[]>([]);

  // Not scoped to the selected subject — fetched once, filtered
  // client-side below, so switching subjects never re-requests either.
  useEffect(() => {
    let cancelled = false;
    void getProgressSummary()
      .then((data) => {
        if (!cancelled) setRealProgress(data);
      })
      .catch(() => {
        // No backend data yet (or the request failed) — headline tiles
        // stay at their neutral zero/dash state below.
      });
    // "Статистика вариантов" — every real variant session the user has
    // ever started, across all subjects, never scoped to the selected
    // subject (a variant run isn't filtered the way topic/task-number
    // progress is).
    void getVariantProgress()
      .then((res) => {
        if (!cancelled) setVariantHistory(res.items);
      })
      .catch(() => {
        if (!cancelled) setVariantHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The full mistakes feed only feeds the "По темам" donut — fetched when
  // that tab is first opened, not on every visit to the overview.
  const needsMistakes = subTab === 'byTopic';
  useEffect(() => {
    if (!needsMistakes) return;
    let cancelled = false;
    void getMistakes()
      .then((items) => {
        if (!cancelled) setMistakes(items.map(toSampleMistake));
      })
      .catch(() => {
        if (!cancelled) setMistakes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsMistakes]);

  useEffect(() => {
    let cancelled = false;
    const id = subject.id;
    void getProgressByTaskNumber({ subject: id })
      .then((res) => {
        if (!cancelled) setTaskNumberData({ subjectId: id, items: res.items });
      })
      .catch(() => {
        if (!cancelled) setTaskNumberData({ subjectId: id, items: [] });
      });
    void getProgressByTopic({ subject: id })
      .then((res) => {
        if (!cancelled) setTopicData({ subjectId: id, items: res.items });
      })
      .catch(() => {
        if (!cancelled) setTopicData({ subjectId: id, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [subject.id]);

  const taskNumberItems = useMemo(
    () => (taskNumberData?.subjectId === subject.id ? taskNumberData.items : null),
    [taskNumberData, subject.id],
  );
  const topicsLoaded = topicData?.subjectId === subject.id;
  const topics = useMemo(
    () => (topicData?.subjectId === subject.id ? topicData.items : []),
    [topicData, subject.id],
  );

  const subjectMistakes = useMemo(
    () => mistakes.filter((m) => m.subjectId === subject.id),
    [mistakes, subject.id],
  );
  const difficultTopics = useMemo(
    () =>
      subjectMistakes.length > 0
        ? computeMistakesSummary(subjectMistakes).topicBreakdown.filter(
            (row) => row.topic !== 'Остальные',
          )
        : [],
    [subjectMistakes],
  );
  const taskNumberProgress = useMemo(
    () => toTaskNumberProgress(taskNumberItems ?? []),
    [taskNumberItems],
  );
  const subjectRow = realProgress?.bySubject.find((s) => s.subjectId === subject.id) ?? null;
  // null while `realProgress` hasn't loaded yet — never a fake `0`
  // (same mobile-flash bug fixed in Subject/Profile: `realProgress`
  // itself is correctly null-until-loaded, but collapsing it to 0 here
  // threw that honesty away for the UI).
  // «Решено» = distinct tasks solved correctly (`uniqueSolved`), never the
  // attempt-row count `solved`: answering one task three times is not «3».
  const solvedTotal = realProgress ? (subjectRow?.uniqueSolved ?? 0) : null;
  const accuracyPercent = subjectRow
    ? Math.round(subjectRow.accuracyPercent)
    : realProgress
      ? 0
      : null;
  // «из N»: every published task of the subject, other editions (ЕГЭ
  // 2027) included — `solvedTotal` counts tasks from any source, so a
  // «Все источники»-only total could be overtaken by it.
  const subjectTotalTasks = allSourcesCounts ? (allSourcesCounts[subject.id] ?? 0) : null;
  const totalLabel = subjectTotalTasks ?? '···';

  function selectSubject(id: string) {
    setSubjectId(id);
    setSubjectPickerOpen(false);
    // The previously selected number may not even exist for the new
    // subject — same precedent as StatisticsDesktop's selectSubject.
    setSelectedTaskNumber(null);
  }

  // The number last opened stays marked in the strip/cards after coming back.
  const [lastOpenedTaskNumber, setLastOpenedTaskNumber] = useState<number | null>(null);
  function openDetail(taskNumber: number) {
    setSelectedTaskNumber(taskNumber);
    setLastOpenedTaskNumber(taskNumber);
  }

  function openTopic(topic: ProgressByTopicResponse['items'][number]) {
    startRealTask(navigate, { subject: subject.id, topic: topic.topicId });
  }

  useEffect(() => {
    if (selectedTaskNumber === null) return;
    let cancelled = false;
    void getTaskNumberStatisticsDetail(subject.id, selectedTaskNumber)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subject.id, selectedTaskNumber]);

  // The detail fetch above only ever resolves for the number it was
  // started for — once the selection changes, a previous result (if
  // any) is stale and must not flash before the new fetch resolves.
  const displayedDetail = detail && detail.taskNumber === selectedTaskNumber ? detail : undefined;

  if (selectedTaskNumber !== null) {
    return (
      <SlideUp className={styles.stack}>
        <BackRow label="Статистика" onBack={() => setSelectedTaskNumber(null)} />
        <Card className={styles.cardHeaderRow}>
          <p className="text-h3">№{selectedTaskNumber}</p>
        </Card>
        <TaskNumberDetailPanel taskNumber={selectedTaskNumber} detail={displayedDetail} />
      </SlideUp>
    );
  }

  return (
    <SlideUp className={styles.stack}>
      <SubjectHeaderMobile
        subject={subject}
        title="Статистика"
        onSelectSubject={() => setSubjectPickerOpen(true)}
        trailing={
          <button type="button" className={styles.trailingButton} aria-label="Выбрать период">
            <Icon name="calendar" size={20} />
          </button>
        }
      />

      <SubjectPickerDialog
        open={subjectPickerOpen}
        onClose={() => setSubjectPickerOpen(false)}
        value={subject.id}
        onSelect={selectSubject}
        subtitle="Статистика покажется по выбранному предмету"
      />

      <Tabs
        items={subTabs}
        activeId={subTab}
        onChange={setSubTab}
        aria-label="Раздел статистики"
        scrollable
      />

      {subTab === 'byTask' && (
        <FadeIn className={styles.stack}>
          <Card className={styles.summaryCard}>
            <CircularProgress value={accuracyPercent ?? 0} size={72} label="Твой прогресс">
              <span className="text-body" style={{ fontWeight: 700 }}>
                {accuracyPercent !== null ? `${accuracyPercent}%` : '···'}
              </span>
            </CircularProgress>
            <div>
              <p className="text-body" style={{ fontWeight: 700 }}>
                {solvedTotal ?? '···'} из {totalLabel}
              </p>
              <p className="text-body-sm text-secondary">заданий решено</p>
            </div>
          </Card>
          <Card>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Задания по номерам</p>
            </div>
            <p
              className="text-body-sm text-secondary"
              style={{ marginTop: 'calc(var(--space-2) * -1)' }}
            >
              Нажми на номер задания, чтобы посмотреть подробную статистику
            </p>
            {taskNumberItems ? (
              <TaskNumberGrid
                rows={taskNumberProgress}
                onSelect={openDetail}
                activeNumber={lastOpenedTaskNumber}
              />
            ) : (
              <Skeleton className={styles.gridPlaceholder} aria-label="Загрузка заданий" />
            )}
          </Card>
        </FadeIn>
      )}

      {subTab === 'byTopic' && (
        <FadeIn className={styles.stack}>
          <Card>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Темы ЕГЭ</p>
            </div>
            <div className={styles.topicList}>
              {topicsLoaded && topics.length === 0 && (
                <p className="text-body-sm text-secondary">Пока нет данных по темам.</p>
              )}
              {!topicsLoaded && <Skeleton height="3rem" aria-label="Загрузка тем" />}
              {topics.map((topic) => {
                const percent =
                  topic.total > 0 ? Math.round((topic.completed / topic.total) * 100) : 0;
                return (
                  <TopicProgressRow
                    key={topic.topicId}
                    icon="topic"
                    topic={topic.topicName}
                    masteryPercent={percent}
                    onSelect={() => openTopic(topic)}
                  />
                );
              })}
            </div>
          </Card>
          <Card className={styles.donutCard}>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Распределение ошибок по темам</p>
            </div>
            {difficultTopics.length === 0 ? (
              <p className="text-body-sm text-secondary">Пока нет данных об ошибках.</p>
            ) : (
              <DonutChart
                ariaLabel="Распределение ошибок по темам"
                size={160}
                segments={difficultTopics.map((t) => ({
                  label: t.topic,
                  value: t.percent,
                  percent: t.percent,
                  color: t.color,
                }))}
                centerLabel={
                  <>
                    <p className="text-h3">
                      <AnimatedNumber value={difficultTopics.length} />
                    </p>
                    <p className="text-body-sm text-secondary">тем</p>
                  </>
                }
              />
            )}
          </Card>
        </FadeIn>
      )}

      {subTab === 'exams' && (
        <FadeIn className={styles.stack}>
          {variantHistory.length === 0 ? (
            <Card>
              <p className="text-h3">Ты ещё не решал варианты</p>
              <p className="text-body-sm text-secondary">
                Пройди полный вариант ЕГЭ — его результаты появятся здесь.
              </p>
            </Card>
          ) : (
            <div className={styles.variantList}>
              {variantHistory.map((item) => (
                <VariantHistoryCard key={item.sessionId} item={item} />
              ))}
            </div>
          )}
        </FadeIn>
      )}

      {subTab === 'achievements' && (
        <FadeIn className={styles.stack}>
          {/* No achievements backend exists yet (unlock logic,
              categories, progress tracking) — the same honest
              placeholder the standalone Достижения screen already
              shows, never fabricated unlock data. */}
          <WipPlaceholder title="Достижения" note="Экран в разработке — следующий блок." />
        </FadeIn>
      )}

      {subTab === 'rating' && (
        <FadeIn className={styles.stack}>
          {/* The real board (GET /leaderboard) — the same component as the
              standalone «Рейтинг», with its own period/subject filters. */}
          <RatingBoard embedded />
        </FadeIn>
      )}

      {subTab === 'overview' && (
        <>
          <div className={styles.statsGrid}>
            <StatTile
              animate
              icon="variant"
              iconColor="var(--color-accent-primary-end)"
              label="Решено заданий"
              value={solvedTotal ?? '···'}
              deltaLabel={`из ${totalLabel}`}
            />
            <StatTile
              animate
              icon="progress"
              iconColor="var(--color-accent-secondary)"
              label="Точность"
              value={accuracyPercent ?? '···'}
              suffix={accuracyPercent !== null ? '%' : undefined}
              deltaLabel={`${subjectRow?.correct ?? 0} верных`}
            />
            <StatTile
              animate
              icon="xp"
              iconColor="var(--color-gold)"
              label="Текущая серия"
              value="—"
              deltaLabel="скоро"
            />
            <StatTile
              animate
              icon="time"
              iconColor="var(--color-accent-primary)"
              label="Среднее время"
              value="—"
              deltaLabel="скоро"
            />
          </div>

          <ActivityCharts subjectId={subject.id} />

          <Card>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Прогресс по заданиям</p>
            </div>
            {taskNumberItems ? (
              <TaskNumberBars
                rows={taskNumberProgress}
                onSelect={openDetail}
                activeNumber={lastOpenedTaskNumber}
              />
            ) : (
              <Skeleton className={styles.barsPlaceholder} aria-label="Загрузка прогресса" />
            )}
          </Card>

          <Card>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Прогресс по темам</p>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => navigate({ screen: 'subjectCatalog' })}
              >
                Все темы <Icon name="chevronRight" size={14} />
              </button>
            </div>
            <div className={styles.topicList}>
              {topicsLoaded && topics.length === 0 && (
                <p className="text-body-sm text-secondary">Пока нет данных по темам.</p>
              )}
              {!topicsLoaded && <Skeleton height="3rem" aria-label="Загрузка тем" />}
              {topics.map((topic) => {
                const percent =
                  topic.total > 0 ? Math.round((topic.completed / topic.total) * 100) : 0;
                return (
                  <TopicProgressRow
                    key={topic.topicId}
                    icon="topic"
                    topic={topic.topicName}
                    masteryPercent={percent}
                    onSelect={() => openTopic(topic)}
                  />
                );
              })}
            </div>
          </Card>

          <div>
            <div className={styles.cardHeaderRow}>
              <p className="text-h3">Статистика вариантов</p>
            </div>
            {variantHistory.length === 0 ? (
              <Card>
                <p className="text-body-sm text-secondary">
                  Реши свой первый вариант в Тренировке — он появится здесь.
                </p>
              </Card>
            ) : (
              <div className={styles.variantList}>
                {variantHistory.map((item) => (
                  <VariantHistoryCard key={item.sessionId} item={item} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </SlideUp>
  );
}
