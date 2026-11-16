import { examSkillInfo } from './examSkills.js';
import type { ProblemType } from './diagnosis.js';

/**
 * Advice base (docs/learning/PERSONAL-PLANS.md § База советов). One entry per
 * (subject, problem type), plus specific entries for EGE numbers where the
 * fix is well known. Entries describe HOW to work on the problem and point
 * to the project's own theory page of the number (`theory`) for the rules
 * themselves — the base never restates or invents EGE rules or tasks.
 * A combination without a specific entry falls back to the subject's generic
 * one and is reported by `adviceCoverage` as a gap of the base.
 */
export interface Advice {
  readonly id: string;
  readonly problem: ProblemType;
  /** Short name of the problem, shown on the card. */
  readonly title: string;
  /** What exactly goes wrong. */
  readonly whatIsWrong: string;
  /** Why it usually happens. */
  readonly why: string;
  /** What to review. */
  readonly review: readonly string[];
  /** A concrete fixing algorithm, step by step. */
  readonly steps: readonly string[];
  /** Tasks to solve while fixing it, and at which difficulty. */
  readonly practice: { readonly tasks: number; readonly difficulty: 'easy' | 'mixed' | 'hard' };
  /** The check that it is fixed: N tasks of the number, at least this accuracy. */
  readonly control: { readonly tasks: number; readonly passAccuracy: number };
  /** Link the number's theory page of the learning centre. */
  readonly linksTheory: boolean;
  /** True for a subject-wide fallback (not written for this exact number). */
  readonly generic: boolean;
}

type Entry = Omit<Advice, 'id' | 'generic'>;

const SUBJECT_GENERIC: Readonly<Record<'math' | 'russian', Partial<Record<ProblemType, Entry>>>> = {
  math: {
    algorithm_gap: {
      problem: 'algorithm_gap',
      title: 'Нет устойчивого алгоритма решения',
      whatIsWrong:
        'Ошибки встречаются в разных заданиях этого номера, а не в одном типе: решение строится каждый раз заново.',
      why: 'Номер решают по нескольким типовым схемам. Пока схема не выучена, каждое задание кажется новым.',
      review: [
        'Теорию этого номера в учебном центре: типы заданий и способ решения каждого.',
        'Разборы двух-трёх своих ошибок по этому номеру.',
      ],
      steps: [
        'Открой теорию номера и выпиши алгоритм решения по шагам.',
        'Реши 3 базовых задания, сверяясь с алгоритмом на каждом шаге.',
        'Разбери каждое неверное решение: найди шаг алгоритма, на котором ошибся.',
        'Реши ещё 5 заданий уже без подсказок.',
      ],
      practice: { tasks: 8, difficulty: 'easy' },
      control: { tasks: 5, passAccuracy: 70 },
      linksTheory: true,
    },
    formula_misuse: {
      problem: 'formula_misuse',
      title: 'Разбор понятен, но не применяется',
      whatIsWrong:
        'После просмотра решения тот же тип задания снова решается неверно: формула или приём применяются не к тому случаю.',
      why: 'Разбор читается как готовый ответ, а условие применения формулы (когда она работает) не запоминается.',
      review: ['Теорию номера: формулы и условия, при которых каждая применима.'],
      steps: [
        'Выпиши формулы номера и рядом — когда каждая применяется.',
        'В следующих заданиях до вычислений называй вслух, какую формулу берёшь и почему.',
        'Реши 4 задания, закрывая разбор до ответа.',
        'Повтори задания, где ошибся после разбора, через день.',
      ],
      practice: { tasks: 6, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 75 },
      linksTheory: true,
    },
    computational: {
      problem: 'computational',
      title: 'Вычислительные ошибки',
      whatIsWrong:
        'Способ решения верный, но ответ отличается от правильного знаком, положением запятой или небольшой величиной.',
      why: 'Вычисления делаются в уме и не проверяются; на ответ не делается прикидка.',
      review: ['Действия с отрицательными числами и дробями — по своим ошибкам.'],
      steps: [
        'Записывай промежуточные вычисления, не держи их в уме.',
        'Перед записью ответа сделай прикидку: какого знака и порядка он должен быть.',
        'Проверь ответ подстановкой или обратным действием.',
        'Реши 5 заданий с обязательной проверкой каждого ответа.',
      ],
      practice: { tasks: 5, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 80 },
      linksTheory: false,
    },
    condition: {
      problem: 'condition',
      title: 'Условие учтено не полностью',
      whatIsWrong:
        'Ответ частично верный или пустой: часть требований условия (что найти, в каких единицах, какой из корней) упущена.',
      why: 'Условие читается один раз и сразу начинается решение.',
      review: ['Формулировки вопросов этого номера: что именно нужно записать в ответ.'],
      steps: [
        'Прочитай условие дважды и подчеркни, что требуется найти.',
        'Перед ответом перечитай вопрос и сверь с ним то, что получилось.',
        'Реши 4 задания, проговаривая перед ответом: «нужно найти …».',
      ],
      practice: { tasks: 4, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 80 },
      linksTheory: false,
    },
    confuses_methods: {
      problem: 'confuses_methods',
      title: 'Похожие типы заданий путаются',
      whatIsWrong:
        'Один вид заданий номера решается уверенно, а похожий на него — нет: выбирается приём от соседнего типа.',
      why: 'Типы различаются деталью условия, на которую не обращается внимание.',
      review: ['Теорию номера: чем различаются его типы заданий и какой приём к какому относится.'],
      steps: [
        'Составь таблицу: признак в условии → тип задания → приём решения.',
        'Реши по 2 задания каждого типа подряд, перед решением называя тип.',
        'Затем реши 4 задания вперемешку.',
      ],
      practice: { tasks: 8, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 75 },
      linksTheory: true,
    },
    careless: {
      problem: 'careless',
      title: 'Ошибки по невнимательности',
      whatIsWrong:
        'Большинство заданий решается верно, а ошибки исправляются со второй попытки без разбора — ты знаешь решение.',
      why: 'Спешка: ответ записывается без проверки.',
      review: ['Свои исправленные ошибки: где именно была описка.'],
      steps: [
        'Перед каждым ответом — 10 секунд проверки: условие, вычисления, формат ответа.',
        'Реши 5 заданий без ограничения по времени, проверяя каждое.',
        'Отмечай, сколько ошибок поймал при проверке.',
      ],
      practice: { tasks: 5, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 90 },
      linksTheory: false,
    },
    hard_tasks: {
      problem: 'hard_tasks',
      title: 'Не получаются сложные задания',
      whatIsWrong: 'Базовые задания номера решаются, а задания повышенной сложности — нет.',
      why: 'Сложные задания комбинируют несколько шагов; базовый алгоритм есть, а связки шагов нет.',
      review: ['Разборы сложных заданий этого номера: из каких базовых шагов они состоят.'],
      steps: [
        'Разбери 2 сложных задания по готовому решению и выпиши их шаги.',
        'Реши 3 задания средней сложности без подсказки.',
        'Переходи к сложным: 3 задания, по одному в день.',
      ],
      practice: { tasks: 6, difficulty: 'hard' },
      control: { tasks: 3, passAccuracy: 67 },
      linksTheory: true,
    },
    forgetting: {
      problem: 'forgetting',
      title: 'Материал забывается после перерыва',
      whatIsWrong: 'До перерыва номер решался хорошо, а после — заметно хуже.',
      why: 'Без повторения навык ослабевает за 2–3 недели.',
      review: ['Теорию номера — коротко, по своим конспектам или странице учебного центра.'],
      steps: [
        'Повтори теорию номера (10–15 минут).',
        'Реши 4 задания, чтобы вспомнить алгоритм.',
        'Дальше возвращайся к номеру хотя бы раз в неделю — 2–3 задания.',
      ],
      practice: { tasks: 4, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 75 },
      linksTheory: true,
    },
  },
  russian: {
    theory_gap: {
      problem: 'theory_gap',
      title: 'Правило не усвоено',
      whatIsWrong:
        'Ошибки в разных заданиях этого номера: правило применяется наугад, а не по алгоритму.',
      why: 'Правило помнится в общих чертах, без условий и исключений.',
      review: ['Теорию этого номера в учебном центре: правило, условия и исключения.'],
      steps: [
        'Прочитай теорию номера и выпиши правило в виде алгоритма: «если …, то …».',
        'Реши 3 задания, проговаривая для каждого слова или предложения, какое условие правила сработало.',
        'Выпиши слова и предложения, в которых ошибся, и найди для них пункт правила.',
        'Реши ещё 5 заданий без подсказок.',
      ],
      practice: { tasks: 8, difficulty: 'easy' },
      control: { tasks: 5, passAccuracy: 70 },
      linksTheory: true,
    },
    formula_misuse: {
      problem: 'formula_misuse',
      title: 'Разбор понятен, но правило не применяется',
      whatIsWrong:
        'После просмотра разбора то же задание снова решается неверно: правило применяется не к тому случаю.',
      why: 'Разбор запоминается как готовый ответ, а условие правила — нет.',
      review: ['Теорию номера: условия, при которых правило работает, и исключения.'],
      steps: [
        'Для каждой своей ошибки выпиши, какое условие правила ты пропустил.',
        'В следующих заданиях до ответа называй условие, по которому делаешь выбор.',
        'Реши 4 задания, не открывая разбор до ответа.',
      ],
      practice: { tasks: 6, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 75 },
      linksTheory: true,
    },
    condition: {
      problem: 'condition',
      title: 'Найдены не все варианты',
      whatIsWrong:
        'В ответе часть верных вариантов есть, а часть пропущена или добавлена лишняя: каждый вариант не проверяется отдельно.',
      why: 'Задание просит все подходящие варианты, а проверка останавливается на первом найденном.',
      review: ['Формулировку задания: сколько вариантов может быть верным и что нужно записать.'],
      steps: [
        'Проверяй каждый вариант отдельно и ставь рядом «+» или «−».',
        'Только после проверки всех вариантов записывай ответ.',
        'Реши 4 задания по этой схеме.',
      ],
      practice: { tasks: 4, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 80 },
      linksTheory: false,
    },
    confuses_methods: {
      problem: 'confuses_methods',
      title: 'Похожие правила путаются',
      whatIsWrong:
        'Задания на одно правило номера решаются уверенно, а на соседнее, похожее — нет.',
      why: 'Правила различаются признаком, который при чтении не замечается.',
      review: ['Теорию номера: чем различаются похожие правила и как их отличить.'],
      steps: [
        'Выпиши признаки, по которым различаются похожие случаи.',
        'Реши по 2 задания на каждый случай, перед ответом называя признак.',
        'Затем реши 4 задания вперемешку.',
      ],
      practice: { tasks: 8, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 75 },
      linksTheory: true,
    },
    careless: {
      problem: 'careless',
      title: 'Ошибки по невнимательности',
      whatIsWrong:
        'Большинство заданий решается верно, а ошибки исправляются со второй попытки без разбора.',
      why: 'Спешка: ответ записывается без проверки.',
      review: ['Свои исправленные ошибки: что именно было пропущено.'],
      steps: [
        'Перед ответом перечитай задание и проверь каждый выбранный вариант.',
        'Реши 5 заданий без спешки.',
      ],
      practice: { tasks: 5, difficulty: 'mixed' },
      control: { tasks: 5, passAccuracy: 90 },
      linksTheory: false,
    },
    hard_tasks: {
      problem: 'hard_tasks',
      title: 'Трудные случаи правила',
      whatIsWrong: 'Простые задания номера решаются, а задания с трудными случаями — нет.',
      why: 'Трудные случаи опираются на исключения и тонкости правила.',
      review: ['Исключения и трудные случаи в теории номера.'],
      steps: [
        'Выпиши исключения и трудные случаи из теории номера.',
        'Реши 3 трудных задания, сверяясь с выпиской.',
        'Реши 3 трудных задания без выписки.',
      ],
      practice: { tasks: 6, difficulty: 'hard' },
      control: { tasks: 3, passAccuracy: 67 },
      linksTheory: true,
    },
    forgetting: {
      problem: 'forgetting',
      title: 'Правило забывается после перерыва',
      whatIsWrong: 'До перерыва номер решался хорошо, а после — заметно хуже.',
      why: 'Без повторения правила забываются за 2–3 недели.',
      review: ['Теорию номера — коротко.'],
      steps: [
        'Повтори теорию номера (10 минут).',
        'Реши 4 задания.',
        'Возвращайся к номеру раз в неделю — 2–3 задания.',
      ],
      practice: { tasks: 4, difficulty: 'mixed' },
      control: { tasks: 4, passAccuracy: 75 },
      linksTheory: true,
    },
  },
};
// Russian has no numeric answers: a «вычислительная ошибка» does not exist
// there; math «theory_gap» is named algorithm_gap.
const ALIASES: Partial<Record<ProblemType, ProblemType>> = {};

/**
 * Number-specific entries: only where the distinction is a well-known part of
 * the number's rules. The rules themselves are on the theory page.
 */
const SPECIFIC: Readonly<Record<string, Partial<Entry>>> = {
  'russian:15:confuses_methods': {
    title: 'Н и НН: путаются части речи',
    whatIsWrong:
      'Задания на «одну Н» и на «НН» решаются по-разному успешно: не определяется, от какого слова и какой частью речи образовано слово с пропуском.',
    steps: [
      'Для каждого слова с пропуском сначала определи часть речи (прилагательное, причастие, наречие, существительное).',
      'Затем — от какого слова оно образовано и с каким суффиксом; по теории номера выбери Н или НН.',
      'Реши по 2 задания на «одну Н» и на «НН», затем 4 вперемешку.',
    ],
  },
  'russian:13:confuses_methods': {
    title: 'НЕ и НИ: слитно и раздельно',
    whatIsWrong:
      'Задания «пишется слитно» и «пишется раздельно» решаются по-разному успешно: не определяется часть речи слова с НЕ.',
    steps: [
      'Для каждого выделенного слова сначала определи часть речи и наличие зависимых слов или противопоставления.',
      'По теории номера выбери слитное или раздельное написание.',
      'Реши по 2 задания на каждую формулировку, затем 4 вперемешку.',
    ],
  },
  'russian:14:confuses_methods': {
    title: 'Слитно, раздельно, через дефис',
    whatIsWrong:
      'Формулировки «слитно», «раздельно» и «через дефис» решаются по-разному успешно: не определяется часть речи выделенного слова.',
    steps: [
      'Для каждой пары выделенных слов определи часть речи: предлог, союз, наречие или сочетание.',
      'Проверь замену или вопрос, которые приводит теория номера.',
      'Реши по 2 задания на каждую формулировку, затем 4 вперемешку.',
    ],
  },
  'russian:21:confuses_methods': {
    title: 'Знаки препинания: путаются правила',
    whatIsWrong:
      'Задания на один знак (запятая, тире, двоеточие) решаются заметно хуже, чем на другие.',
    steps: [
      'Для каждого знака в тексте определи, какое правило его объясняет, и выпиши номер правила.',
      'Сравнивай предложения только по правилу, а не по виду знака.',
      'Реши по 2 задания на каждый знак, затем 4 вперемешку.',
    ],
  },
  'math:14:confuses_methods': {
    title: 'Стереометрия: углы и расстояния путаются',
    whatIsWrong:
      'Один вид вопроса (угол или расстояние) решается заметно лучше другого: построение выбирается от соседнего вида.',
    steps: [
      'Перед решением пункта б) запиши, что ищется: угол между прямыми, прямой и плоскостью, плоскостями — или расстояние.',
      'Для каждого вида по теории номера выпиши, что нужно построить (например, для угла между прямой и плоскостью — проекцию прямой на плоскость).',
      'Реши по 2 задания каждого вида, затем 3 вперемешку.',
    ],
  },
};

const UNIVERSAL: Entry = {
  problem: 'unclear',
  title: 'Нужна диагностика',
  whatIsWrong: 'По твоим ответам пока нельзя надёжно сказать, в чём причина ошибок в этом номере.',
  why: 'Ответов мало или ошибки слишком разные.',
  review: ['Теорию номера в учебном центре.'],
  steps: [
    'Реши диагностическую подборку из 5 заданий разной сложности, не открывая разбор до ответа.',
    'После неё рекомендация уточнится по твоим ответам.',
  ],
  practice: { tasks: 5, difficulty: 'mixed' },
  control: { tasks: 5, passAccuracy: 70 },
  linksTheory: true,
};

/** The advice for a number and a diagnosed problem. Never null. */
export function adviceFor(
  subjectId: string,
  examNumber: number | null,
  problem: ProblemType,
): Advice {
  const p = ALIASES[problem] ?? problem;
  if (p === 'unclear' || p === 'insufficient_data' || p === 'none') {
    return {
      ...UNIVERSAL,
      problem: p,
      ...(p === 'none'
        ? {
            title: 'Поддерживай уровень',
            whatIsWrong: 'Ошибок почти нет — номер решается уверенно.',
            why: 'Без повторения навык со временем ослабевает.',
            steps: ['Решай 2–3 задания номера раз в неделю.'],
            practice: { tasks: 3, difficulty: 'hard' as const },
          }
        : {}),
      id: `${subjectId}:*:${p}`,
      generic: true,
    };
  }
  const subject = subjectId === 'math' || subjectId === 'russian' ? subjectId : null;
  const base =
    (subject && SUBJECT_GENERIC[subject][p]) ??
    (subject && p === 'theory_gap' ? SUBJECT_GENERIC[subject].algorithm_gap : undefined) ??
    (subject && p === 'algorithm_gap' ? SUBJECT_GENERIC[subject].theory_gap : undefined) ??
    (subject && p === 'computational' ? SUBJECT_GENERIC[subject].careless : undefined);
  if (!base) {
    return { ...UNIVERSAL, problem: p, id: `${subjectId}:*:${p}`, generic: true };
  }
  const specific = examNumber !== null ? SPECIFIC[`${subjectId}:${examNumber}:${p}`] : undefined;
  return specific
    ? { ...base, ...specific, problem: p, id: `${subjectId}:${examNumber}:${p}`, generic: false }
    : { ...base, problem: p, id: `${subjectId}:*:${p}`, generic: true };
}

/** Concrete problem types the base has a subject-level entry for. */
export function adviceCoverage(): {
  readonly specific: readonly string[];
  readonly subjectLevel: Readonly<Record<string, readonly ProblemType[]>>;
} {
  return {
    specific: Object.keys(SPECIFIC).sort(),
    subjectLevel: Object.fromEntries(
      Object.entries(SUBJECT_GENERIC).map(([s, m]) => [s, Object.keys(m) as ProblemType[]]),
    ),
  };
}

/** Human title of the number for advice texts, e.g. «№13 · Уравнения». */
export function adviceSkillLabel(skillKey: string): string {
  const info = examSkillInfo(skillKey);
  if (!info) return skillKey;
  return info.examNumber ? `№${info.examNumber} · ${info.title}` : info.title;
}
