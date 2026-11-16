import type {
  AdviceResponse,
  PersonalRecommendationsResponse,
  PlanDayView,
  PlanResponse,
  SkillProgressResponse,
} from '@zybrilka/shared';

/** Test data shaped exactly like the API responses (docs/learning/PERSONAL-PLANS.md). */
export const personalFixture: PersonalRecommendationsResponse = {
  summary: {
    priorityTopics: 3,
    potentialPrimaryPoints: 4,
    etaDays: 7,
    etaBasis: 'week_plan',
    activePlan: null,
  },
  recommendations: [
    {
      subjectId: 'math',
      skillKey: 'math.equations-advanced',
      examNumber: 13,
      title: 'Уравнения (развёрнутый ответ)',
      kind: 'repeated_errors',
      priority: 92,
      priorityLevel: 'high',
      reason: 'Ошибки повторяются.',
      problem: {
        type: 'computational',
        title: 'Вычислительные ошибки',
        summary: '2 неверных ответа из 3 почти совпадают с верным (знак, запятая, близкое число).',
        evidence: [
          '2 неверных ответа из 3 почти совпадают с верным (знак, запятая, близкое число).',
        ],
      },
      progress: { mastery: 41, level: 'weak', attempts: 8, accuracy: 50 },
      suggestedTasks: 3,
      taskIds: ['a', 'b', 'c'],
    },
    {
      subjectId: 'math',
      skillKey: 'math.vectors',
      examNumber: 2,
      title: 'Векторы',
      kind: 'low_data',
      priority: 42,
      priorityLevel: 'low',
      reason: 'Мало данных.',
      problem: {
        type: 'insufficient_data',
        title: 'Нужна диагностика',
        summary: 'Пока 1 попытка и 0 ошибок — этого мало, чтобы понять причину.',
        evidence: ['Пока 1 попытка и 0 ошибок — этого мало, чтобы понять причину.'],
      },
      progress: { mastery: null, level: 'low_data', attempts: 1, accuracy: 100 },
      suggestedTasks: 3,
      taskIds: ['d', 'e', 'f'],
    },
    {
      subjectId: 'russian',
      skillKey: 'russian.15-n-nn',
      examNumber: 15,
      title: 'Н и НН',
      kind: 'weak',
      priority: 60,
      priorityLevel: 'medium',
      reason: 'Слабо.',
      problem: {
        type: 'confuses_methods',
        title: 'Н и НН: путаются части речи',
        summary: 'Задания одного вида решаются на 80%, похожего на него — на 20%.',
        evidence: ['Задания одного вида решаются на 80%, похожего на него — на 20%.'],
      },
      progress: { mastery: 48, level: 'weak', attempts: 9, accuracy: 44 },
      suggestedTasks: 5,
      taskIds: ['g', 'h', 'i', 'j', 'k'],
    },
  ],
};

export function adviceFixture(over: Partial<AdviceResponse> = {}): AdviceResponse {
  return {
    skillKey: 'math.equations-advanced',
    subjectId: 'math',
    examNumber: 13,
    title: 'Уравнения (развёрнутый ответ)',
    problem: personalFixture.recommendations[0]!.problem,
    alsoProblems: [],
    advice: {
      id: 'math:*:computational',
      problem: 'computational',
      title: 'Вычислительные ошибки',
      whatIsWrong: 'Способ решения верный, но ответ отличается знаком.',
      why: 'Вычисления делаются в уме.',
      review: ['Действия с отрицательными числами.'],
      steps: ['Записывай промежуточные вычисления.', 'Проверь ответ подстановкой.'],
      practice: { tasks: 5, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 80 },
      linksTheory: true,
      generic: true,
    },
    theory: { subjectId: 'math', taskNumber: 13 },
    stats: {
      mastery: 41,
      level: 'weak',
      confidence: 60,
      attempts: 8,
      solvedTasks: 3,
      accuracy: 50,
      incorrect: 4,
      repeatedErrorTasks: 1,
      trend: null,
    },
    availableTasks: 35,
    ...over,
  };
}

function day(i: number, over: Partial<PlanDayView> = {}): PlanDayView {
  return {
    dayIndex: i,
    date: `2026-11-${String(16 + i).padStart(2, '0')}`,
    skillKey: 'math.equations-advanced',
    skillTitle: 'Уравнения (развёрнутый ответ)',
    examNumber: 13,
    activity: i === 0 ? 'theory_basic' : 'practice',
    activityTitle: i === 0 ? 'Теория и базовые задания' : 'Тренировка',
    steps: ['Реши задания.'],
    targetTasks: 4,
    difficulty: 2,
    done: 0,
    correct: 0,
    status: 'pending',
    canSkip: true,
    canMove: true,
    ...over,
  };
}

export function planFixture(over: Partial<PlanResponse> = {}): PlanResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    subjectId: 'math',
    kind: 'week',
    status: 'active',
    startDate: '2026-11-16',
    endDate: '2026-11-22',
    today: '2026-11-16',
    movesLeft: 3,
    progress: {
      percent: 0,
      daysDone: 0,
      daysTotal: 7,
      daysSkipped: 0,
      daysMissed: 0,
      tasksDone: 1,
      tasksTotal: 28,
      tasksLeft: 27,
      finished: false,
    },
    focus: [
      {
        skillKey: 'math.equations-advanced',
        title: 'Уравнения (развёрнутый ответ)',
        examNumber: 13,
        problem: 'computational',
        before: { mastery: 41, accuracy: 50 },
        now: { mastery: 41, accuracyInPlan: null, attemptsInPlan: 1 },
        masteryDelta: null,
        accuracyDelta: null,
        enoughData: false,
      },
    ],
    days: Array.from({ length: 7 }, (_, i) =>
      day(i, i === 0 ? { done: 1, status: 'partial' } : {}),
    ),
    ...over,
  };
}

export function progressFixture(over: Partial<SkillProgressResponse> = {}): SkillProgressResponse {
  return {
    skillKey: 'math.vectors',
    subjectId: 'math',
    examNumber: 2,
    title: 'Векторы',
    stats: {
      mastery: null,
      level: 'low_data',
      confidence: 10,
      attempts: 1,
      solvedTasks: 1,
      accuracy: 100,
      incorrect: 0,
      repeatedErrorTasks: 0,
      trend: null,
    },
    problem: personalFixture.recommendations[1]!.problem,
    dynamics: {
      last7: { attempts: 1, accuracy: 100 },
      prev7: { attempts: 0, accuracy: null },
      last30: { attempts: 1, accuracy: 100 },
      prev30: { attempts: 0, accuracy: null },
      delta7: null,
      delta30: null,
    },
    series: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-10-${String(18 + i).padStart(2, '0')}`.replace(/-1[0]-(3[2-9]|4\d)/, '-11-01'),
      attempts: i === 29 ? 1 : 0,
      correct: i === 29 ? 1 : 0,
      rolling7: i === 29 ? 100 : null,
    })),
    history: [{ date: '2026-11-16', attempts: 1, correct: 1 }],
    goal: { targetMastery: 55, planId: null },
    plan: null,
    planProgress: null,
    ...over,
  };
}
