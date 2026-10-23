/**
 * Seed "Мои ошибки" content (S1 Block 6, approved design — desktop/
 * mobile 08_mistakes.png). Shaped like a real attempt-history table —
 * one row per wrong attempt, subject/topic/task-scoped — so a real
 * backend (task attempts + errors) can replace this module later
 * without the screens changing. All aggregate numbers on the Mistakes
 * and Statistics screens are computed from this array, never
 * hardcoded, per the approved screenshots' own distribution
 * (Неравенства 7, Функции 5, Планиметрия 4, Стереометрия 3,
 * Вероятность 2, +3 others = 24 — matching desktop/08's 29/21/17/12/8%
 * topic split exactly).
 */
export type MistakeStatus = 'unsolved' | 'reviewed';

export interface Mistake {
  id: string;
  taskId: string;
  taskNumber: number;
  subjectId: string;
  topic: string;
  difficultyLabel: 'Лёгкое' | 'Среднее' | 'Сложное';
  condition: string;
  /** ISO date of the attempt. */
  date: string;
  userAnswer: string;
  correctAnswer: string;
  status: MistakeStatus;
  /** This exact task has been answered wrong more than once. */
  repeated: boolean;
}

export const mistakes: readonly Mistake[] = [
  {
    id: 'm1',
    taskId: 'demo-3214',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Сложное',
    condition: 'Решите неравенство: log₂(x² − 3x − 4) ≥ 1',
    date: '2026-09-25',
    userAnswer: '(−∞; 2]',
    correctAnswer: '(−∞; −1] ∪ [2; +∞)',
    status: 'unsolved',
    repeated: true,
  },
  {
    id: 'm2',
    taskId: 'demo-e11',
    taskNumber: 11,
    subjectId: 'math',
    topic: 'Функции',
    difficultyLabel: 'Среднее',
    condition: 'Найдите наибольшее значение функции f(x) = x³ − 3x² − 9x + 4',
    date: '2026-09-23',
    userAnswer: '−1',
    correctAnswer: '9',
    status: 'unsolved',
    repeated: false,
  },
  {
    id: 'm3',
    taskId: 'demo-e15',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Планиметрия',
    difficultyLabel: 'Среднее',
    condition: 'В треугольнике ABC известно, что AB = 7, BC = 5, угол C равен 90°…',
    date: '2026-09-21',
    userAnswer: '6',
    correctAnswer: '√74',
    status: 'unsolved',
    repeated: false,
  },
  {
    id: 'm4',
    taskId: 'demo-e14',
    taskNumber: 14,
    subjectId: 'math',
    topic: 'Стереометрия',
    difficultyLabel: 'Среднее',
    condition: 'В правильной четырёхугольной пирамиде сторона основания равна 6…',
    date: '2026-09-18',
    userAnswer: '18',
    correctAnswer: '24',
    status: 'unsolved',
    repeated: true,
  },
  {
    id: 'm5',
    taskId: 'demo-e4',
    taskNumber: 4,
    subjectId: 'math',
    topic: 'Уравнения',
    difficultyLabel: 'Лёгкое',
    condition: 'Решите уравнение: 4^(x+1) − 3 · 2^x = 0',
    date: '2026-09-16',
    userAnswer: '0',
    correctAnswer: '−2',
    status: 'unsolved',
    repeated: false,
  },
  {
    id: 'm6',
    taskId: 'demo-e10',
    taskNumber: 10,
    subjectId: 'math',
    topic: 'Вероятность',
    difficultyLabel: 'Сложное',
    condition: 'В случайном эксперименте бросают два одинаковых кубика…',
    date: '2026-09-12',
    userAnswer: '1/6',
    correctAnswer: '5/36',
    status: 'unsolved',
    repeated: false,
  },
  {
    id: 'm7',
    taskId: 'demo-in1',
    taskNumber: 16,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Среднее',
    condition: 'Решите неравенство: |x − 3| + |x + 1| ≤ 6',
    date: '2026-09-10',
    userAnswer: '[−4; 3]',
    correctAnswer: '[−4; 4]',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm8',
    taskId: 'demo-in2',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Сложное',
    condition: 'Решите неравенство: log₃(2x − 1) < log₃(x + 4)',
    date: '2026-09-08',
    userAnswer: '(0,5; +∞)',
    correctAnswer: '(0,5; 5)',
    status: 'reviewed',
    repeated: true,
  },
  {
    id: 'm9',
    taskId: 'demo-in3',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Среднее',
    condition: 'Решите неравенство: (x − 2)(x + 5) / (3 − x) ≥ 0',
    date: '2026-09-06',
    userAnswer: '[−5; 3]',
    correctAnswer: '[−5; 2] ∪ [3; +∞)',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm10',
    taskId: 'demo-in4',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Сложное',
    condition: 'Решите неравенство: √(x + 6) > x',
    date: '2026-09-04',
    userAnswer: '(−6; 3)',
    correctAnswer: '[−6; 3)',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm11',
    taskId: 'demo-in5',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Среднее',
    condition: 'Решите неравенство: 5^x − 5^(2−x) < 24',
    date: '2026-09-02',
    userAnswer: '(−∞; 2)',
    correctAnswer: '(−∞; 2)',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm12',
    taskId: 'demo-in6',
    taskNumber: 15,
    subjectId: 'math',
    topic: 'Неравенства',
    difficultyLabel: 'Лёгкое',
    condition: 'Решите неравенство: x² − 5x + 6 < 0',
    date: '2026-08-30',
    userAnswer: '(−∞; 2) ∪ (3; +∞)',
    correctAnswer: '(2; 3)',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm13',
    taskId: 'demo-fn2',
    taskNumber: 11,
    subjectId: 'math',
    topic: 'Функции',
    difficultyLabel: 'Среднее',
    condition: 'Найдите точку минимума функции y = x² · ln x',
    date: '2026-08-28',
    userAnswer: '1',
    correctAnswer: '1/√e',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm14',
    taskId: 'demo-fn3',
    taskNumber: 11,
    subjectId: 'math',
    topic: 'Функции',
    difficultyLabel: 'Сложное',
    condition: 'Найдите промежутки убывания функции y = (x − 4)eˣ',
    date: '2026-08-26',
    userAnswer: '(4; +∞)',
    correctAnswer: '(−∞; 3)',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm15',
    taskId: 'demo-fn4',
    taskNumber: 11,
    subjectId: 'math',
    topic: 'Функции',
    difficultyLabel: 'Среднее',
    condition: 'Найдите наименьшее значение функции y = 2x + 8/x на промежутке (0; +∞)',
    date: '2026-08-24',
    userAnswer: '10',
    correctAnswer: '8',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm16',
    taskId: 'demo-fn5',
    taskNumber: 11,
    subjectId: 'math',
    topic: 'Функции',
    difficultyLabel: 'Сложное',
    condition: 'Найдите количество точек экстремума функции y = x³ − 12x + 7',
    date: '2026-08-22',
    userAnswer: '1',
    correctAnswer: '2',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm17',
    taskId: 'demo-pl2',
    taskNumber: 13,
    subjectId: 'math',
    topic: 'Планиметрия',
    difficultyLabel: 'Среднее',
    condition: 'В окружность вписан четырёхугольник ABCD, угол A равен 70°…',
    date: '2026-08-20',
    userAnswer: '70°',
    correctAnswer: '110°',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm18',
    taskId: 'demo-pl3',
    taskNumber: 13,
    subjectId: 'math',
    topic: 'Планиметрия',
    difficultyLabel: 'Сложное',
    condition: 'Биссектрисы углов A и B параллелограмма ABCD пересекаются в точке K…',
    date: '2026-08-18',
    userAnswer: '90°',
    correctAnswer: '90°',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm19',
    taskId: 'demo-pl4',
    taskNumber: 13,
    subjectId: 'math',
    topic: 'Планиметрия',
    difficultyLabel: 'Среднее',
    condition: 'Площадь трапеции ABCD с основаниями 6 и 14 равна 100…',
    date: '2026-08-16',
    userAnswer: '8',
    correctAnswer: '10',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm20',
    taskId: 'demo-st2',
    taskNumber: 14,
    subjectId: 'math',
    topic: 'Стереометрия',
    difficultyLabel: 'Сложное',
    condition: 'В кубе ABCDA₁B₁C₁D₁ найдите угол между прямыми AC₁ и BD',
    date: '2026-08-14',
    userAnswer: '45°',
    correctAnswer: '90°',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm21',
    taskId: 'demo-st3',
    taskNumber: 14,
    subjectId: 'math',
    topic: 'Стереометрия',
    difficultyLabel: 'Среднее',
    condition: 'Объём конуса равен 100. Радиус основания увеличили в 2 раза…',
    date: '2026-08-12',
    userAnswer: '200',
    correctAnswer: '400',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm22',
    taskId: 'demo-pr2',
    taskNumber: 10,
    subjectId: 'math',
    topic: 'Вероятность',
    difficultyLabel: 'Среднее',
    condition: 'Вероятность того, что новая шариковая ручка пишет плохо, равна 0,1…',
    date: '2026-08-10',
    userAnswer: '0,9',
    correctAnswer: '0,81',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm23',
    taskId: 'demo-vec1',
    taskNumber: 12,
    subjectId: 'math',
    topic: 'Векторы',
    difficultyLabel: 'Среднее',
    condition: 'Найдите наибольшее значение выражения 7cos α + 24sin α',
    date: '2026-08-08',
    userAnswer: '31',
    correctAnswer: '25',
    status: 'reviewed',
    repeated: false,
  },
  {
    id: 'm24',
    taskId: 'demo-perc1',
    taskNumber: 9,
    subjectId: 'math',
    topic: 'Проценты',
    difficultyLabel: 'Лёгкое',
    condition: 'Товар подорожал на 20%, затем подешевел на 20%. На сколько процентов…',
    date: '2026-08-06',
    userAnswer: '0',
    correctAnswer: '4',
    status: 'reviewed',
    repeated: false,
  },
];

const topicIcon: Record<
  string,
  'topicEquations' | 'topicFunctions' | 'topicPlanimetry' | 'topicStereometry' | 'topicProbability'
> = {
  Неравенства: 'topicEquations',
  Уравнения: 'topicEquations',
  Функции: 'topicFunctions',
  Планиметрия: 'topicPlanimetry',
  Стереометрия: 'topicStereometry',
  Вероятность: 'topicProbability',
};

export function getTopicIcon(topic: string) {
  return topicIcon[topic] ?? 'topicEquations';
}

const topicColor: Record<string, string> = {
  Неравенства: 'var(--chart-1)',
  Функции: 'var(--chart-2)',
  Планиметрия: 'var(--chart-3)',
  Стереометрия: 'var(--chart-4)',
  Вероятность: 'var(--chart-5)',
  Уравнения: 'var(--chart-6)',
};

/** The same per-topic hue used in the topic donut, keyed by topic name
 * so a mistake card's chip always matches its slice of the chart. */
export function getTopicColor(topic: string) {
  return topicColor[topic] ?? 'var(--chart-7)';
}

export interface MistakesSummary {
  total: number;
  unsolvedCount: number;
  repeatedPercent: number;
  reviewedAgainCount: number;
  improvementPercent: number;
  topicBreakdown: readonly { topic: string; color: string; count: number; percent: number }[];
  mostFrequent: readonly { topic: string; count: number }[];
}

const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
];

/** Every number here is derived from `mistakes`, never hardcoded. */
export function computeMistakesSummary(items: readonly Mistake[] = mistakes): MistakesSummary {
  const total = items.length;
  const unsolvedCount = items.filter((m) => m.status === 'unsolved').length;
  const repeatedCount = items.filter((m) => m.repeated).length;
  const reviewedAgainCount = items.filter((m) => m.status === 'reviewed').length;

  const byTopic = new Map<string, number>();
  for (const m of items) {
    byTopic.set(m.topic, (byTopic.get(m.topic) ?? 0) + 1);
  }
  const sortedTopics = [...byTopic.entries()].sort((a, b) => b[1] - a[1]);

  const topN = 5;
  const topTopics = sortedTopics.slice(0, topN);
  const otherCount = sortedTopics.slice(topN).reduce((sum, [, count]) => sum + count, 0);

  const breakdownSource =
    otherCount > 0 ? [...topTopics, ['Остальные', otherCount] as const] : topTopics;

  const topicBreakdown = breakdownSource.map(([topic, count], i) => ({
    topic,
    count,
    percent: Math.round((count / total) * 100),
    color: chartColors[i % chartColors.length]!,
  }));

  return {
    total,
    unsolvedCount,
    repeatedPercent: total ? Math.round((repeatedCount / total) * 100) : 0,
    reviewedAgainCount,
    // Share of these mistakes the student has since answered correctly —
    // derived from the list itself, never a fixed figure.
    improvementPercent: total ? Math.round((reviewedAgainCount / total) * 100) : 0,
    topicBreakdown,
    mostFrequent: topTopics.map(([topic, count]) => ({ topic, count })),
  };
}
