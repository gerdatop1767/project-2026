import { examSkillInfo, examSkillsForSubject } from './examSkills.js';
import type { DiagnosisDetail, ProblemType } from './diagnosis.js';
import { numberCard, type NumberCard } from './numberCards.js';

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
  /** How the problem shows in this number's answers. */
  readonly howItShows?: string;
  /** Concrete exercises for this number. */
  readonly exercises?: readonly string[];
  /** When the problem counts as fixed. */
  readonly successCriterion?: string;
  /** Headings of the number's theory page to open. */
  readonly theorySections?: readonly string[];
  /** The subtype or part the advice is about, when the diagnosis named it. */
  readonly focus?: {
    readonly kind: 'subtype' | 'part';
    readonly key: string;
    readonly label: string;
  } | null;
}

type Entry = Omit<
  Advice,
  'id' | 'generic' | 'howItShows' | 'exercises' | 'successCriterion' | 'theorySections' | 'focus'
>;

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

// ------------------------------------------------------------ number cards

/** Problem types a card has number-specific advice for. */
export function cardProblems(card: NumberCard): ProblemType[] {
  const out: ProblemType[] = [
    card.subjectId === 'russian' ? 'theory_gap' : 'algorithm_gap',
    'formula_misuse',
    'condition',
    'careless',
    'hard_tasks',
    'forgetting',
  ];
  if (card.subjectId === 'math') out.push('computational');
  if ((card.subtypes?.length ?? 0) >= 2) out.push('confuses_methods');
  if (card.missed) out.push('missed_items');
  if (card.extra) out.push('extra_items');
  if (card.parts) out.push('weak_part');
  return out;
}

function numberLabel(card: NumberCard): string {
  const n = examSkillInfo(card.skill)?.examNumber;
  return n ? `№${n}` : `«${card.name}»`;
}

interface Composed extends Entry {
  readonly howItShows: string;
  readonly exercises: readonly string[];
  readonly successCriterion: string;
  readonly theorySections: readonly string[];
  readonly focus: Advice['focus'];
}

function tasksWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} задание`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} задания`;
  return `${n} заданий`;
}

function criterion(card: NumberCard, control: Entry['control'], extra: string): string {
  return `${tasksWord(control.tasks)} ${numberLabel(card)} подряд без открытия разбора, не меньше ${control.passAccuracy}% верных; ${extra}`;
}

function theoryLine(card: NumberCard, sections: readonly string[]): string {
  return `Теория ${numberLabel(card)}: ${sections.map((h) => `«${h}»`).join(', ')}.`;
}

/**
 * The advice of a number's card for a problem type. `detail` (from the
 * diagnosis) narrows it to the weakest subtype or part when the evidence
 * named one. Null when the card has no content for this combination.
 */
function composeFromCard(
  card: NumberCard,
  p: ProblemType,
  detail: DiagnosisDetail | null,
): Composed | null {
  const no = numberLabel(card);
  const isMath = card.subjectId === 'math';
  const sections = card.theory;
  const exercises = card.exercises;
  const base = { problem: p, linksTheory: true, theorySections: sections, focus: null };
  switch (p) {
    case 'algorithm_gap':
    case 'theory_gap': {
      const control = { tasks: 5, passAccuracy: 70 };
      const kinds = card.subtypes?.length
        ? ` Виды заданий номера: ${card.subtypes.map((s) => s.label.toLowerCase()).join(', ')}.`
        : '';
      return {
        ...base,
        title: isMath ? 'Нет устойчивого алгоритма решения' : 'Правило не усвоено',
        whatIsWrong: `Ошибки встречаются в разных заданиях ${no}, а не в одном виде: решение не идёт по одной схеме.`,
        howItShows: `Низкая точность в разных заданиях ${no} (${card.name}).${kinds}`,
        why: `${isMath ? 'Алгоритм' : 'Правило'} номера не закреплён, поэтому каждое задание решается заново. Опора номера: ${card.rule}.`,
        review: [theoryLine(card, sections)],
        steps: [
          `Прочитай в теории ${no} разделы ${sections
            .slice(0, 3)
            .map((h) => `«${h}»`)
            .join(', ')} и выпиши алгоритм.`,
          ...card.algorithm.map(
            (a, i) => `Шаг ${i + 1} алгоритма: ${a.charAt(0).toLowerCase()}${a.slice(1)}`,
          ),
          'Реши 3 базовых задания, сверяясь с алгоритмом на каждом шаге, затем 5 — без подсказок.',
        ],
        exercises,
        practice: { tasks: 8, difficulty: 'easy' },
        control,
        successCriterion: criterion(
          card,
          control,
          'ошибки не повторяются в разных заданиях номера.',
        ),
      };
    }
    case 'formula_misuse': {
      const control = { tasks: 4, passAccuracy: 75 };
      return {
        ...base,
        title: isMath
          ? 'Разбор понятен, но не применяется'
          : 'Разбор понятен, но правило не применяется',
        whatIsWrong: `После просмотра разбора задание ${no} снова решается неверно: ${isMath ? 'формула или приём применяются' : 'правило применяется'} не к тому случаю.`,
        howItShows: `Ошибки повторяются уже после открытого решения того же задания ${no}.`,
        why: `Разбор запоминается как готовый ответ, а условие применения — нет. Главное условие ${no}: ${card.rule}.`,
        review: [theoryLine(card, sections.slice(0, 2))],
        steps: [
          `Выпиши опорное правило ${no} и условие, когда оно работает: ${card.rule}.`,
          'Перед каждым заданием назови вслух, что применяешь и почему здесь это можно.',
          'Реши 4 задания, закрывая разбор до своего ответа.',
          'Через день реши заново задания, в которых ошибся после разбора.',
        ],
        exercises,
        practice: { tasks: 6, difficulty: 'mixed' },
        control,
        successCriterion: criterion(
          card,
          control,
          'ни одной ошибки в задании, решение которого ты уже видел.',
        ),
      };
    }
    case 'computational': {
      if (!isMath) return null;
      const control = { tasks: 5, passAccuracy: 80 };
      return {
        ...base,
        title: 'Вычислительные ошибки',
        whatIsWrong: `Способ решения ${no} верный, но ответ отличается от правильного знаком, запятой или небольшой величиной.`,
        howItShows: `Типичная описка ${no}: ${card.slip}.`,
        why: 'Промежуточные вычисления не записываются и не проверяются, прикидки ответа нет.',
        review: [`Свои неверные ответы ${no}: на каком шаге появилась описка.`],
        steps: [
          'Записывай промежуточные вычисления, не держи их в уме.',
          `Проверяй именно место частой описки: ${card.slip}.`,
          `Проверка ответа: ${card.selfCheck}.`,
          'Реши 5 заданий с обязательной проверкой каждого ответа.',
        ],
        exercises: [
          `Для 5 своих ответов ${no} проверь: ${card.selfCheck}.`,
          ...exercises.slice(0, 1),
        ],
        practice: { tasks: 5, difficulty: 'mixed' },
        control,
        linksTheory: false,
        successCriterion: criterion(card, control, 'нет ответов, «почти совпадающих» с верным.'),
      };
    }
    case 'condition': {
      const control = { tasks: 4, passAccuracy: 80 };
      return {
        ...base,
        title: 'Условие учтено не полностью',
        whatIsWrong: `Ответ ${no} частично верный или пустой: часть требований задания упущена.`,
        howItShows: `В ${no} чаще всего упускают ${card.conditionTrap}.`,
        why: 'Задание читается один раз, и решение начинается сразу.',
        review: [`Формулировки заданий ${no}: что именно нужно записать в ответ.`],
        steps: [
          'Прочитай задание дважды и подчеркни, что нужно записать в ответ.',
          `Отдельно найди в условии: ${card.conditionTrap}.`,
          'Перед записью ответа сверь его с вопросом.',
          'Реши 4 задания, проговаривая перед ответом «нужно найти …».',
        ],
        exercises: [
          `В 4 заданиях ${no} подчеркни требование к ответу до решения.`,
          ...exercises.slice(0, 1),
        ],
        practice: { tasks: 4, difficulty: 'mixed' },
        control,
        linksTheory: false,
        successCriterion: criterion(card, control, 'нет пустых и частично верных ответов.'),
      };
    }
    case 'confuses_methods': {
      const subtypes = card.subtypes ?? [];
      if (subtypes.length < 2) return null;
      const control = { tasks: 5, passAccuracy: 75 };
      const weak =
        detail?.kind === 'subtype' ? subtypes.find((s) => s.key === detail.key) : undefined;
      return {
        ...base,
        title: isMath ? 'Похожие типы заданий путаются' : 'Похожие правила путаются',
        whatIsWrong: weak
          ? `Задания ${no} вида «${weak.label}» решаются заметно хуже, чем другие виды номера.`
          : `Один вид заданий ${no} решается уверенно, а похожий — нет.`,
        howItShows: `Виды ${no}: ${subtypes.map((s) => `«${s.label}»`).join(', ')}${weak ? `; слабый — «${weak.label}»` : ''}.`,
        why: 'Виды различаются деталью условия, на которую не обращается внимание, и выбирается приём соседнего вида.',
        review: [theoryLine(card, sections)],
        steps: [
          `Составь таблицу «признак в условии → вид → приём»: ${subtypes.map((s) => `${s.label} — ${s.method}`).join('; ')}.`,
          ...(weak
            ? [`Начни с вида «${weak.label}»: ${weak.method}. Реши 3 задания этого вида подряд.`]
            : []),
          'Реши по 2 задания каждого вида, перед решением называя вид.',
          'Затем 4 задания вперемешку.',
        ],
        exercises,
        practice: { tasks: 8, difficulty: 'mixed' },
        control,
        focus: weak ? { kind: 'subtype', key: weak.key, label: weak.label } : null,
        successCriterion: criterion(
          card,
          control,
          weak
            ? `вид «${weak.label}» — не хуже остальных.`
            : 'разница между видами не больше 20 п.п.',
        ),
      };
    }
    case 'careless': {
      const control = { tasks: 5, passAccuracy: 90 };
      return {
        ...base,
        title: 'Ошибки по невнимательности',
        whatIsWrong: `Большинство заданий ${no} решается верно, а ошибки исправляются со второй попытки без разбора.`,
        howItShows: `Частая описка ${no}: ${card.slip}.`,
        why: 'Спешка: ответ записывается без проверки.',
        review: [`Свои исправленные ошибки ${no}: что именно было пропущено.`],
        steps: [
          'Перед каждым ответом — 10 секунд на проверку.',
          `Проверь место частой описки: ${card.slip}.`,
          `Способ проверки: ${card.selfCheck}.`,
          'Реши 5 заданий без спешки и отмечай ошибки, пойманные при проверке.',
        ],
        exercises: [`В 5 заданиях ${no} запиши ответ только после проверки: ${card.selfCheck}.`],
        practice: { tasks: 5, difficulty: 'mixed' },
        control,
        linksTheory: false,
        successCriterion: criterion(
          card,
          control,
          'ни одной ошибки, которую ты исправил бы сам со второй попытки.',
        ),
      };
    }
    case 'hard_tasks': {
      const control = { tasks: 3, passAccuracy: 67 };
      return {
        ...base,
        title: isMath ? 'Не получаются сложные задания' : 'Трудные случаи правила',
        whatIsWrong: `Базовые задания ${no} решаются, а задания повышенной сложности — нет.`,
        howItShows: `Сложные задания ${no}: ${card.hard}.`,
        why: 'Базовый алгоритм есть, а связки шагов и трудных случаев — нет.',
        review: [theoryLine(card, sections.slice(-3))],
        steps: [
          `Разбери 2 сложных задания ${no} по готовому решению и выпиши их шаги.`,
          `Отметь, что в них добавлено к базовому алгоритму: ${card.hard}.`,
          'Реши 3 задания средней сложности без подсказки.',
          'Затем 3 сложных — по одному в день.',
        ],
        exercises,
        practice: { tasks: 6, difficulty: 'hard' },
        control,
        successCriterion: `${control.tasks} сложных задания ${no} без разбора, верно не меньше двух.`,
      };
    }
    case 'forgetting': {
      const control = { tasks: 4, passAccuracy: 75 };
      return {
        ...base,
        title: isMath ? 'Материал забывается после перерыва' : 'Правило забывается после перерыва',
        whatIsWrong: `До перерыва ${no} решался хорошо, а после — заметно хуже.`,
        howItShows: `После перерыва в ${no} снова ошибаешься там, где опора — ${card.rule}.`,
        why: 'Без повторения навык ослабевает за 2–3 недели.',
        review: [theoryLine(card, sections.slice(0, 3))],
        steps: [
          `Повтори теорию ${no} (10–15 минут): ${sections
            .slice(0, 3)
            .map((h) => `«${h}»`)
            .join(', ')}.`,
          `Запиши по памяти алгоритм и сверь с теорией: ${card.algorithm.map((a, i) => `${i + 1}) ${a}`).join(' ')}`,
          'Реши 4 задания.',
          'Дальше возвращайся к номеру раз в неделю — 2–3 задания.',
        ],
        exercises: exercises.slice(0, 1),
        practice: { tasks: 4, difficulty: 'mixed' },
        control,
        successCriterion: criterion(card, control, 'уровень до перерыва восстановлен.'),
      };
    }
    case 'missed_items':
    case 'extra_items': {
      const e = p === 'missed_items' ? card.missed : card.extra;
      if (!e) return null;
      const control = { tasks: 5, passAccuracy: 80 };
      const roots = card.skill === 'math.equations-advanced';
      return {
        ...base,
        title:
          p === 'missed_items'
            ? roots
              ? 'Потерянные корни'
              : 'Найдены не все верные варианты'
            : roots
              ? 'Лишние корни'
              : 'Лишние варианты в ответе',
        whatIsWrong: e.howItShows,
        howItShows: `${e.howItShows} ${e.cause}`,
        why: e.cause,
        review: [theoryLine(card, sections)],
        steps: [
          e.fix,
          ...card.algorithm.slice(-2),
          'Реши 5 заданий, проверяя каждый вариант по этой схеме.',
        ],
        exercises,
        practice: { tasks: 5, difficulty: 'mixed' },
        control,
        successCriterion: criterion(
          card,
          control,
          p === 'missed_items'
            ? roots
              ? 'ни в одном ответе не потерян корень.'
              : 'ни в одном ответе не пропущен верный вариант.'
            : roots
              ? 'ни в одном ответе нет лишнего корня.'
              : 'ни в одном ответе нет лишнего варианта.',
        ),
      };
    }
    case 'weak_part': {
      const part =
        detail?.kind === 'part' ? card.parts?.items.find((i) => i.key === detail.key) : undefined;
      if (!part) return null;
      const control = { tasks: 4, passAccuracy: 75 };
      return {
        ...base,
        title: `Не получается: ${part.label.toLowerCase()}`,
        whatIsWrong: `В заданиях ${no} раз за разом неверна одна часть — «${part.label}», остальные получаются.`,
        howItShows: part.howItShows,
        why: part.cause,
        review: [theoryLine(card, part.theory)],
        steps: [...part.steps, 'Затем реши 4 задания номера целиком, проверяя эту часть первой.'],
        exercises: [part.exercise, ...exercises.slice(0, 1)],
        practice: { tasks: 6, difficulty: 'mixed' },
        control,
        theorySections: part.theory,
        focus: { kind: 'part', key: part.key, label: part.label },
        successCriterion: criterion(
          card,
          control,
          `часть «${part.label}» верна не меньше чем в 3 из 4 заданий.`,
        ),
      };
    }
    default:
      return null;
  }
}

/** «Нужна диагностика» / «всё хорошо», with the number's own diagnostic set. */
function diagnosticAdvice(card: NumberCard | null, p: ProblemType): Composed {
  const no = card ? numberLabel(card) : 'номера';
  const kinds = card?.subtypes?.length
    ? ` — по заданию каждого вида: ${card.subtypes.map((s) => s.label.toLowerCase()).join(', ')}`
    : '';
  const control = UNIVERSAL.control;
  if (p === 'none') {
    return {
      ...UNIVERSAL,
      problem: p,
      title: 'Поддерживай уровень',
      whatIsWrong: `Ошибок почти нет — ${no} решается уверенно.`,
      howItShows: 'Не больше одной ошибки на все ответы.',
      why: 'Без повторения навык со временем ослабевает.',
      steps: [`Решай 2–3 задания ${no} раз в неделю, начиная со сложных.`],
      practice: { tasks: 3, difficulty: 'hard' },
      exercises: card?.exercises.slice(0, 1) ?? [],
      successCriterion: `Точность ${no} не ниже 80% на каждой неделе.`,
      theorySections: card?.theory ?? [],
      focus: null,
    };
  }
  return {
    ...UNIVERSAL,
    problem: p,
    whatIsWrong: `По твоим ответам пока нельзя надёжно сказать, в чём причина ошибок в ${no}.`,
    howItShows:
      p === 'insufficient_data'
        ? 'Ответов пока слишком мало, чтобы назвать причину.'
        : 'Ошибки есть, но ни одна причина не подтверждается достаточным числом ответов.',
    why: 'Причину ошибки нельзя определить по одному-двум ответам — нужна подборка.',
    review: card ? [theoryLine(card, card.theory.slice(0, 2))] : UNIVERSAL.review,
    steps: [
      `Реши диагностическую подборку из 5 заданий ${no} разной сложности${kinds}.`,
      'Не открывай разбор до ответа: так будет видно, где именно ошибка.',
      'После подборки рекомендация уточнится по твоим ответам.',
    ],
    exercises: [],
    successCriterion: `Подборка решена: по ${control.tasks} ответам станет видно, есть ли проблема.`,
    theorySections: card?.theory ?? [],
    focus: null,
  };
}

function subjectFallback(subjectId: string, p: ProblemType): Entry | undefined {
  const subject = subjectId === 'math' || subjectId === 'russian' ? subjectId : null;
  if (!subject) return undefined;
  return (
    SUBJECT_GENERIC[subject][p] ??
    (p === 'theory_gap' ? SUBJECT_GENERIC[subject].algorithm_gap : undefined) ??
    (p === 'algorithm_gap' ? SUBJECT_GENERIC[subject].theory_gap : undefined) ??
    (p === 'computational' ? SUBJECT_GENERIC[subject].careless : undefined) ??
    (p === 'missed_items' || p === 'extra_items'
      ? SUBJECT_GENERIC[subject].condition
      : undefined) ??
    (p === 'weak_part' ? SUBJECT_GENERIC[subject].confuses_methods : undefined)
  );
}

/**
 * The advice for an exam skill and a diagnosed problem. Never null: a
 * skill without a card (another subject) gets the subject-level advice,
 * marked `generic`.
 */
export function adviceForSkill(
  skillKey: string,
  problem: ProblemType,
  detail: DiagnosisDetail | null = null,
): Advice {
  const info = examSkillInfo(skillKey);
  const subjectId = info?.subjectId ?? skillKey.split('.')[0] ?? '';
  const card = numberCard(skillKey);
  let p = ALIASES[problem] ?? problem;
  if (card?.subjectId === 'russian' && p === 'algorithm_gap') p = 'theory_gap';
  if (card?.subjectId === 'math' && p === 'theory_gap') p = 'algorithm_gap';
  if (card?.subjectId === 'russian' && p === 'computational') p = 'careless';
  if (p === 'unclear' || p === 'insufficient_data' || p === 'none') {
    return { ...diagnosticAdvice(card, p), id: `${skillKey}:${p}`, generic: card === null };
  }
  const composed =
    card &&
    (composeFromCard(card, p, detail) ??
      // A part / subtype the card cannot name: the number's rule advice.
      (p === 'weak_part' || p === 'confuses_methods'
        ? composeFromCard(card, card.subjectId === 'russian' ? 'theory_gap' : 'algorithm_gap', null)
        : null));
  if (composed) {
    return {
      ...composed,
      problem: p,
      id: `${skillKey}:${p}${composed.focus ? `:${composed.focus.key}` : ''}`,
      generic: false,
    };
  }
  const base = subjectFallback(subjectId, p);
  if (!base) return { ...UNIVERSAL, problem: p, id: `${subjectId}:*:${p}`, generic: true };
  return { ...base, problem: p, id: `${subjectId}:*:${p}`, generic: true };
}

/**
 * The advice for a number of a subject (the skill whose current-edition
 * number it is) and a diagnosed problem. Never null.
 */
export function adviceFor(
  subjectId: string,
  examNumber: number | null,
  problem: ProblemType,
  detail: DiagnosisDetail | null = null,
): Advice {
  const skill =
    examNumber === null
      ? undefined
      : examSkillsForSubject(subjectId).find((s) => s.examNumber === examNumber)?.key;
  return adviceForSkill(skill ?? `${subjectId}.*`, problem, detail);
}

/** What the base covers: per card, the problem types with specific advice. */
export function adviceCoverage(): {
  readonly specific: readonly string[];
  readonly subjectLevel: Readonly<Record<string, readonly ProblemType[]>>;
} {
  return {
    specific: examSkillsCovered().sort(),
    subjectLevel: Object.fromEntries(
      Object.entries(SUBJECT_GENERIC).map(([s, m]) => [s, Object.keys(m) as ProblemType[]]),
    ),
  };
}

function examSkillsCovered(): string[] {
  const out: string[] = [];
  for (const subject of ['math', 'russian']) {
    for (const s of examSkillsForSubject(subject)) {
      const card = numberCard(s.key);
      if (!card) continue;
      for (const p of cardProblems(card)) out.push(`${s.key}:${p}`);
    }
  }
  return out;
}

/** Human title of the number for advice texts, e.g. «№13 · Уравнения». */
export function adviceSkillLabel(skillKey: string): string {
  const info = examSkillInfo(skillKey);
  if (!info) return skillKey;
  return info.examNumber ? `№${info.examNumber} · ${info.title}` : info.title;
}
