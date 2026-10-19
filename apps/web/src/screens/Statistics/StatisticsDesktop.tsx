import { AnimatedNumber } from '../../ui/AnimatedNumber/AnimatedNumber.js';
import { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import type { StatsPeriod } from '../../data/sampleStatistics.js';
import { computeMistakesSummary, type Mistake } from '../../data/sampleMistakes.js';
import {
  getMistakes,
  getProgressByTaskNumber,
  getProgressDaily,
  getProgressSummary,
  getTaskNumberStatisticsDetail,
  getVariantProgress,
} from '../../lib/api.js';
import { toSampleMistake } from '../../lib/mistakeAdapter.js';
import { toDailyPoints, toTaskNumberProgress } from '../../lib/progressAdapter.js';
import { formatDuration } from '../../lib/statisticsDetailFormat.js';
import type {
  ProgressSummary,
  TaskNumberStatisticsDetail,
  VariantProgressItem,
} from '@zybrilka/shared';
import { Card } from '../../ui/Card/Card.js';
import { VariantHistoryCard } from '../../ui/Statistics/VariantHistoryCard.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { StatTile } from '../../ui/Statistics/StatTile.js';
import { TaskNumberGrid } from '../../ui/Statistics/TaskNumberGrid.js';
import { TaskNumberBars } from '../../ui/Statistics/TaskNumberBars.js';
import { TaskNumberDetailPanel } from '../../ui/Statistics/TaskNumberDetailPanel.js';
import { BarChart } from '../../ui/Charts/BarChart.js';
import { LineChart } from '../../ui/Charts/LineChart.js';
import { DonutChart } from '../../ui/Charts/DonutChart.js';
import { RankedBarList } from '../../ui/Charts/RankedBarList.js';
import { FadeIn } from '../../ui/motion/motion.js';
import { SubjectSelect } from '../../ui/SubjectPicker/SubjectPicker.js';
import styles from './StatisticsDesktop.module.css';

const periodTabs = [
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'all', label: 'Все время' },
] as const;

const periodDays: Record<StatsPeriod, number> = { '7d': 7, '30d': 30, all: 90 };

/**
 * Desktop Statistics (S1 Block 6, approved design —
 * desktop/07_statistics.png): subject + period controls drive a real
 * fetch of `/progress/daily`, zero-filled to the requested window
 * (Block D) — no more seeded/synthetic series. "Сложные темы"/
 * "Распределение по темам" use the real `/mistakes` feed (same
 * `computeMistakesSummary` the Mistakes screens already use), not the
 * static sample set. Average time/level/XP have no backend metric at
 * all and show a neutral "—" rather than a fabricated number.
 */
export function StatisticsDesktop() {
  const { navigate } = useNavigation();
  const [subjectId, setSubjectId] = useState('math');
  const [period, setPeriod] = useState<StatsPeriod>('30d');

  const [realProgress, setRealProgress] = useState<ProgressSummary | null>(null);
  const [dailyItems, setDailyItems] = useState<
    Awaited<ReturnType<typeof getProgressDaily>>['items']
  >([]);
  const [mistakes, setMistakes] = useState<readonly Mistake[]>([]);
  const [taskNumberItems, setTaskNumberItems] = useState<
    Awaited<ReturnType<typeof getProgressByTaskNumber>>['items']
  >([]);
  const [selectedTaskNumber, setSelectedTaskNumber] = useState<number | null>(null);
  // The number last opened stays marked after "Назад к статистике".
  const [lastOpenedTaskNumber, setLastOpenedTaskNumber] = useState<number | null>(null);
  function openTaskNumber(taskNumber: number) {
    setSelectedTaskNumber(taskNumber);
    setLastOpenedTaskNumber(taskNumber);
  }
  const [detail, setDetail] = useState<TaskNumberStatisticsDetail | null | undefined>(undefined);
  const [variantHistory, setVariantHistory] = useState<readonly VariantProgressItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getProgressSummary()
      .then((data) => {
        if (!cancelled) setRealProgress(data);
      })
      .catch(() => {
        // No backend data yet (or the request failed) — headline tiles
        // stay at their neutral zero state below.
      });
    void getMistakes()
      .then((items) => {
        if (!cancelled) setMistakes(items.map(toSampleMistake));
      })
      .catch(() => {
        if (!cancelled) setMistakes([]);
      });
    // "Статистика вариантов" — every real variant session the user has
    // ever started, across all subjects, never scoped to the selected
    // subject selector above.
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

  // "По номерам" (Statistics 2.0 Step 3) — real per-subject task-number
  // coverage, re-fetched whenever the subject selector changes.
  useEffect(() => {
    let cancelled = false;
    void getProgressByTaskNumber({ subject: subjectId })
      .then((res) => {
        if (!cancelled) setTaskNumberItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setTaskNumberItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  useEffect(() => {
    if (selectedTaskNumber === null) return;
    let cancelled = false;
    void getTaskNumberStatisticsDetail(subjectId, selectedTaskNumber)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, selectedTaskNumber]);

  // The detail fetch above only ever resolves for the subject+number it
  // was started for — once either changes, the previous result (if any)
  // is stale and must not flash before the new fetch resolves.
  const displayedDetail = detail && detail.taskNumber === selectedTaskNumber ? detail : undefined;

  function selectSubject(id: string) {
    setSubjectId(id);
    // Switching subject closes any open detail — the selected number
    // may not even exist for the new subject.
    setSelectedTaskNumber(null);
  }

  const days = periodDays[period];
  useEffect(() => {
    let cancelled = false;
    void getProgressDaily({ days, subject: subjectId })
      .then((res) => {
        if (!cancelled) setDailyItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setDailyItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [days, subjectId]);

  // Headline tiles scope to the selected subject (Statistics 2.0 Step
  // 2) using the real per-subject rows `/progress/summary` already
  // returns — no new backend query needed for accuracy/solved.
  const subjectRow = realProgress?.bySubject.find((s) => s.subjectId === subjectId) ?? null;
  const subjectTime = realProgress?.timeBySubject.find((s) => s.subjectId === subjectId) ?? null;
  // null while `realProgress` hasn't loaded yet — never a fake `0`
  // (same mobile-flash bug fixed in Subject/Profile/StatisticsMobile).
  const solvedTotal = realProgress ? (subjectRow?.solved ?? 0) : null;
  const correctTotal = subjectRow?.correct ?? 0;
  const correctPercent = subjectRow
    ? Math.round(subjectRow.accuracyPercent)
    : realProgress
      ? 0
      : null;

  const taskNumberProgress = useMemo(
    () => toTaskNumberProgress(taskNumberItems),
    [taskNumberItems],
  );

  const subjectMistakes = useMemo(
    () => mistakes.filter((m) => m.subjectId === subjectId),
    [mistakes, subjectId],
  );
  const mistakesSummary = useMemo(() => computeMistakesSummary(subjectMistakes), [subjectMistakes]);
  const difficultTopics = useMemo(
    () => mistakesSummary.topicBreakdown.filter((row) => row.topic !== 'Остальные'),
    [mistakesSummary],
  );
  const points = useMemo(() => toDailyPoints(dailyItems, days), [dailyItems, days]);
  const showEvery = points.length > 40 ? 10 : points.length > 14 ? 4 : 3;

  return (
    <FadeIn className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={`text-h1 ${styles.title}`}>Статистика</h1>
          <p className={`text-body-sm text-secondary ${styles.subtitle}`}>
            Твой прогресс, результаты и слабые темы
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.subjectSelect}>
            <SubjectSelect value={subjectId} onChange={selectSubject} />
          </div>
          <Tabs
            items={periodTabs}
            activeId={period}
            onChange={(id) => setPeriod(id as StatsPeriod)}
            aria-label="Период статистики"
            className={styles.periodTabs}
          />
        </div>
      </div>

      <div className={styles.statsRow}>
        <StatTile
          animate
          icon="variant"
          iconColor="var(--color-accent-primary-end)"
          label="Решено заданий"
          value={solvedTotal ?? '···'}
        />
        <StatTile
          animate
          icon="success"
          iconColor="var(--color-success)"
          label="Правильных ответов"
          value={correctPercent ?? '···'}
          suffix={correctPercent !== null ? '%' : undefined}
          deltaLabel={`${correctTotal} из ${solvedTotal ?? '···'}`}
        />
        <StatTile
          animate
          icon="time"
          iconColor="var(--color-warning)"
          label="Среднее время"
          value={subjectTime ? formatDuration(subjectTime.averageTimeMs) : '—'}
          deltaLabel={subjectTime ? `медиана ${formatDuration(subjectTime.medianTimeMs)}` : 'скоро'}
        />
        <StatTile
          animate
          icon="progress"
          iconColor="var(--color-accent-secondary)"
          label="Текущий уровень"
          value="—"
          deltaLabel="скоро"
        />
      </div>

      <div className={styles.chartsGrid}>
        <Card className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div className={styles.chartHeaderText}>
              <p className="text-h3">Активность по дням</p>
              <p className="text-body-sm text-secondary">Количество решённых заданий</p>
            </div>
            <span className={styles.metricLabel}>Решённые задания</span>
          </div>
          <BarChart
            points={points.map((p) => ({ label: p.label, value: p.solved }))}
            labelEvery={showEvery}
          />
        </Card>

        <Card className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <p className="text-h3">Распределение по темам</p>
          </div>
          {mistakesSummary.total === 0 ? (
            <p className="text-body-sm text-secondary">Пока нет данных об ошибках.</p>
          ) : (
            <DonutChart
              ariaLabel="Распределение ошибок по темам"
              segments={mistakesSummary.topicBreakdown.map((s) => ({
                label: s.topic,
                value: s.count,
                percent: s.percent,
                color: s.color,
              }))}
              centerLabel={
                <>
                  <p className="text-h2">
                    <AnimatedNumber value={mistakesSummary.total} />
                  </p>
                  <p className="text-body-sm text-secondary">заданий</p>
                </>
              }
            />
          )}
        </Card>

        <Card className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div className={styles.chartHeaderText}>
              <p className="text-h3">Динамика правильных ответов</p>
            </div>
            <span className={styles.metricLabel}>Процент правильных ответов</span>
          </div>
          <LineChart
            points={points.map((p) => ({ label: p.label, value: p.accuracyPercent }))}
            labelEvery={showEvery}
          />
        </Card>

        <Card className={styles.chartCard}>
          <div className={styles.cardHeaderRow}>
            <div className={styles.chartHeaderText}>
              <p className="text-h3">Сложные темы</p>
              <p className="text-body-sm text-secondary">
                Темы, в которых чаще всего бывают ошибки
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate({ screen: 'mistakes' })}>
              Показать все
            </Button>
          </div>
          {difficultTopics.length === 0 ? (
            <p className="text-body-sm text-secondary">Пока нет данных об ошибках.</p>
          ) : (
            <RankedBarList
              items={difficultTopics.map((t) => ({
                label: t.topic,
                value: t.percent,
                color: t.color,
                displayValue: `${t.percent}%`,
              }))}
              maxValue={100}
            />
          )}
        </Card>
      </div>

      {/* Statistics 2.0 — additive, placed after the existing stats/
          charts above (never replacing them), compact so it reads as
          one quick-scan block rather than a tall list. */}
      {selectedTaskNumber !== null ? (
        <Card>
          <div className={styles.cardHeaderRow}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setSelectedTaskNumber(null)}
            >
              <Icon name="back" size={16} />
              Назад к статистике
            </button>
            <p className="text-h3">№{selectedTaskNumber}</p>
          </div>
          <TaskNumberDetailPanel taskNumber={selectedTaskNumber} detail={displayedDetail} />
        </Card>
      ) : (
        <Card>
          <div className={styles.cardHeaderRow}>
            <p className="text-h3">По номерам</p>
          </div>
          {taskNumberProgress.length === 0 ? (
            <p className="text-body-sm text-secondary">
              Пока нет опубликованных заданий по этому предмету.
            </p>
          ) : (
            <>
              <p className="text-body-sm text-secondary" style={{ marginBottom: 'var(--space-2)' }}>
                Нажми на номер задания, чтобы посмотреть подробную статистику
              </p>
              <div className={styles.numbersWaves}>
                <TaskNumberBars
                  rows={taskNumberProgress}
                  onSelect={openTaskNumber}
                  activeNumber={lastOpenedTaskNumber}
                />
              </div>
              <TaskNumberGrid
                rows={taskNumberProgress}
                onSelect={openTaskNumber}
                activeNumber={lastOpenedTaskNumber}
              />
            </>
          )}
        </Card>
      )}

      <Card>
        <div className={styles.cardHeaderRow}>
          <p className="text-h3">Статистика вариантов</p>
        </div>
        {variantHistory.length === 0 ? (
          <p className="text-body-sm text-secondary">
            Реши свой первый вариант в Тренировке — он появится здесь.
          </p>
        ) : (
          <div className={styles.variantGrid}>
            {variantHistory.map((item) => (
              <VariantHistoryCard key={item.sessionId} item={item} />
            ))}
          </div>
        )}
      </Card>
    </FadeIn>
  );
}
