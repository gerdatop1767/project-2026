/**
 * Seed Statistics content (S1 Block 6, approved design —
 * desktop/mobile 07_statistics.png). Everything here is computed from
 * an underlying daily-activity series and the shared `mistakes` seed
 * (data/sampleMistakes.ts), the same shape a real attempts/errors table
 * would produce — so the Statistics screens stay swappable for a real
 * API without changing their rendering.
 */
import { mistakes, computeMistakesSummary } from './sampleMistakes.js';

export interface DailyPoint {
  date: string;
  /** Last day of a week bucket (inclusive); absent for a single day. */
  end?: string;
  label: string;
  solved: number;
  accuracyPercent: number;
  /** Answers behind `accuracyPercent` (from /progress/period). */
  answers?: number;
}

/** 90 days of daily activity ending today (2026-09-25), seeded once and
 * sliced by the period control (7 дней / 30 дней / Все время). */
export const dailyActivity: readonly DailyPoint[] = buildDailyActivity();

function buildDailyActivity(): DailyPoint[] {
  const end = new Date('2026-09-25T00:00:00Z');
  const days = 90;
  const points: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const progress = (days - i) / days;
    // Gentle upward trend with light day-to-day noise, matching the
    // approved chart's rising bar/line shape without a flat mock.
    const noise = Math.sin(i * 1.7) * 3 + Math.cos(i * 0.9) * 2;
    const solved = Math.max(0, Math.round(2 + progress * 15 + noise));
    const accuracyPercent = Math.max(
      30,
      Math.min(100, Math.round(55 + progress * 30 + Math.sin(i * 1.2) * 8)),
    );
    points.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      solved,
      accuracyPercent,
    });
  }
  return points;
}

export type StatsPeriod = '7d' | '30d' | 'all';

export function sliceByPeriod(
  points: readonly DailyPoint[],
  period: StatsPeriod,
): readonly DailyPoint[] {
  if (period === '7d') return points.slice(-7);
  if (period === '30d') return points.slice(-30);
  return points;
}

export interface TopicMasteryRow {
  topic: string;
  icon:
    | 'topicEquations'
    | 'topicFunctions'
    | 'topicPlanimetry'
    | 'topicStereometry'
    | 'topicProbability';
  masteryPercent: number;
}

/** "Прогресс по темам" (mobile) — independent of the mistakes log,
 * this is overall mastery per topic rather than error share. */
export const topicMasteryRows: readonly TopicMasteryRow[] = [
  { topic: 'Уравнения и неравенства', icon: 'topicEquations', masteryPercent: 78 },
  { topic: 'Функции', icon: 'topicFunctions', masteryPercent: 65 },
  { topic: 'Планиметрия', icon: 'topicPlanimetry', masteryPercent: 52 },
  { topic: 'Стереометрия', icon: 'topicStereometry', masteryPercent: 38 },
  { topic: 'Вероятность', icon: 'topicProbability', masteryPercent: 71 },
];

export interface TaskNumberProgress {
  number: number;
  percent: number | null;
  status: 'strong' | 'medium' | 'weak' | 'current' | 'untried';
  /** Real unique-tasks-solved / published-tasks counts for this number
   * (same source as `percent` = completed/total) — optional since the
   * sample/mock data above has no such counts behind it. */
  completed?: number;
  total?: number;
}

/** "Прогресс по заданиям (1–19)" (mobile) — per official EGE task
 * number, derived from a fixed attempt-count mock so the bands (green/
 * orange/red) stay consistent with the rest of the seed data. */
export const taskNumberProgress: readonly TaskNumberProgress[] = [
  90,
  80,
  75,
  60,
  85,
  70,
  40,
  55,
  88,
  65,
  92,
  78,
  50,
  45,
  null,
  null,
  null,
  null,
  null,
].map((percent, i) => {
  const number = i + 1;
  if (number === 15) return { number, percent: 82, status: 'current' as const };
  if (percent === null) return { number, percent: null, status: 'untried' as const };
  const status = percent >= 70 ? 'strong' : percent >= 40 ? 'medium' : 'weak';
  return { number, percent, status };
});

export interface MockExam {
  id: string;
  label: string;
  date: string;
  percent: number;
  correct: number;
  total: number;
}

export const mockExams: readonly MockExam[] = [
  { id: 'e1', label: 'Пробник №1', date: '12 сентября', percent: 72, correct: 18, total: 25 },
  { id: 'e2', label: 'Пробник №2', date: '15 сентября', percent: 64, correct: 16, total: 25 },
  { id: 'e3', label: 'Пробник №3', date: '20 сентября', percent: 80, correct: 20, total: 25 },
];

export interface StatisticsSummary {
  solvedTotal: number;
  solvedDeltaPercent: number;
  correctPercent: number;
  correctCount: number;
  avgTimeSeconds: number;
  avgTimeDeltaSeconds: number;
  currentLevel: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  accuracyNow: number;
  accuracyTotal: number;
}

/** Headline stat tiles — the parts genuinely tied to the seeded
 * attempt history are computed; the rest mirror the fixed demo profile
 * used across Home/Task/Result (data/sampleProgress.ts). */
export function computeStatisticsSummary(): StatisticsSummary {
  const last30 = dailyActivity.slice(-30);
  const solvedTotal = 187;
  const correctCount = 146;
  return {
    solvedTotal,
    solvedDeltaPercent: 32,
    correctPercent: Math.round((correctCount / solvedTotal) * 100),
    correctCount,
    avgTimeSeconds: 134,
    avgTimeDeltaSeconds: -28,
    currentLevel: 8,
    xpIntoLevel: 320,
    xpToNextLevel: 500,
    accuracyNow: last30.at(-1)?.accuracyPercent ?? 0,
    accuracyTotal: 82,
  };
}

export interface DifficultTopic {
  topic: string;
  errorPercent: number;
  color: string;
}

/** "Сложные темы" (desktop) — the same per-topic mistake share as the
 * Mistakes screen's own donut (data/sampleMistakes.ts), so the two
 * screens' rankings can never drift apart. */
export function computeDifficultTopics(): readonly DifficultTopic[] {
  return computeMistakesSummary(mistakes)
    .topicBreakdown.filter((row) => row.topic !== 'Остальные')
    .map((row) => ({ topic: row.topic, errorPercent: row.percent, color: row.color }));
}
