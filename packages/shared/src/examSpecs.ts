/**
 * Which task numbers each exam edition has, and which topic (rule) each
 * number checks — the bridge between an edition's numbering and the theory.
 *
 * Three editions are kept apart and never mixed (docs/theory/EXAM-NUMBERING.md):
 * - `ege-2026` — ЕГЭ-2026, FIPI specification;
 * - `ege-2027` — the current ЕГЭ-2027 edition, FIPI specification of
 *   13.11.2026. FIPI's «Изменения в КИМ ЕГЭ 2027» says «Изменений нет» for
 *   profile math and for Russian: same numbers, scores and requirements as
 *   2026 (compared position by position);
 * - `ege-2027-project` — the August-2026 FIPI *project* of the 2027 math
 *   exam (20 tasks). It was not adopted, but the Ященко-2027 book in the
 *   app (old edition) follows it, so its tasks keep this numbering.
 *
 * Theory is written once per topic (`ExamTopic.key`), never once per
 * edition: a number binds to one or more topics, and the same topic is
 * reached from every edition under that edition's own number. Numbers are
 * never renumbered to match another edition.
 *
 * Status of every binding is explicit, so nothing guessed passes for fact:
 * - `official` — read in the FIPI specification of that edition;
 * - `secondary` — the FIPI document itself was not read; confirmed by two
 *   independent reviews of it and by the imported tasks of that edition;
 * - `unclear` — sources disagree or say nothing; never used for theory links.
 */

export type ExamSubjectId = 'math' | 'russian';
export type SpecStatus = 'official' | 'secondary' | 'unclear';
export type ExamEditionId = 'ege-2026' | 'ege-2027' | 'ege-2027-project';

/** How a number relates to the same topic in the other editions. */
export type BindingRelation =
  /** Same content, possibly another number. */
  | 'same'
  /** New in this edition. */
  | 'new'
  /** Same content, different format (part, answer type, points). */
  | 'format-changed'
  /** The topic is checked here only as part of a wider task. */
  | 'part-of';

export interface ExamEdition {
  readonly id: ExamEditionId;
  readonly year: number;
  /** Full name, for headers and notes. */
  readonly title: string;
  /** Short name, for tabs and chips. */
  readonly shortTitle: string;
  /** Subjects this edition is defined for. */
  readonly subjects: readonly ExamSubjectId[];
  /** A superseded edition: shown, but always labelled as old. */
  readonly superseded: boolean;
  readonly note: string;
}

export const EXAM_EDITIONS: readonly ExamEdition[] = [
  {
    id: 'ege-2027',
    year: 2027,
    title: 'ЕГЭ-2027 (актуальная редакция ФИПИ)',
    shortTitle: 'ЕГЭ-2027',
    subjects: ['math', 'russian'],
    superseded: false,
    note: 'Спецификация ФИПИ от 13.11.2026. По документу ФИПИ «Изменения в КИМ ЕГЭ 2027 года» изменений нет: номера, баллы и проверяемые требования совпадают с ЕГЭ-2026.',
  },
  {
    id: 'ege-2026',
    year: 2026,
    title: 'ЕГЭ-2026',
    shortTitle: 'ЕГЭ-2026',
    subjects: ['math', 'russian'],
    superseded: false,
    note: 'Спецификация КИМ ЕГЭ-2026 (ФИПИ).',
  },
  {
    id: 'ege-2027-project',
    year: 2027,
    title: 'Проект КИМ ЕГЭ-2027 (август 2026) — старая редакция',
    shortTitle: 'Ященко-2027 · старая редакция',
    subjects: ['math'],
    superseded: true,
    note: 'Проект ФИПИ от 28.08.2026 с 20 заданиями. В окончательную редакцию не вошёл: в актуальном ЕГЭ-2027 19 заданий, как в 2026. По этому проекту составлен сборник Ященко-2027 «36 вариантов» (старая редакция) — его задания сохраняют такую нумерацию.',
  },
];

/** The `source` of every task of the Ященко-2027 book (old edition). Kept
 * here so the web can tell those tasks apart from current-2027 ones. */
export const YASHCHENKO_2027_PROJECT_SOURCE = 'Ященко ЕГЭ 2027. Типовые экзаменационные варианты';
/** Its collection in the app. */
export const YASHCHENKO_2027_PROJECT_COLLECTION = 'ege-2027-yashchenko';

export interface ExamTopic {
  /** Stable id, used by theory and materials: never reused for other content. */
  readonly key: string;
  readonly subjectId: ExamSubjectId;
  readonly title: string;
}

export interface ExamTopicBinding {
  readonly topicKey: string;
  readonly relation: BindingRelation;
  readonly status: SpecStatus;
  readonly note?: string;
}

export interface ExamTaskSpec {
  readonly subjectId: ExamSubjectId;
  readonly edition: ExamEditionId;
  readonly year: number;
  readonly number: number;
  /** 1 = short answer, 2 = extended answer (math); Russian: 2 only for the essay. */
  readonly part: 1 | 2;
  readonly title: string;
  readonly topics: readonly ExamTopicBinding[];
}

const t = (key: string, subjectId: ExamSubjectId, title: string): ExamTopic => ({
  key,
  subjectId,
  title,
});

export const EXAM_TOPICS: readonly ExamTopic[] = [
  // ---- Profile math ----
  t('math.planimetry', 'math', 'Планиметрия: вычисление длин, углов, площадей'),
  t('math.vectors', 'math', 'Векторы'),
  t('math.stereometry', 'math', 'Стереометрия: объёмы, площади, углы, расстояния'),
  t('math.probability-basic', 'math', 'Вероятность случайного события'),
  t('math.probability-rules', 'math', 'Вероятность: сложение, умножение, полная вероятность'),
  t('math.random-variables', 'math', 'Случайная величина: распределение, ожидание, дисперсия'),
  t('math.equations-simple', 'math', 'Простейшие уравнения'),
  t('math.expressions', 'math', 'Вычисления и преобразования выражений'),
  t('math.derivative-graphs', 'math', 'Производная: смысл, графики, касательная, первообразная'),
  t('math.derivative-investigation', 'math', 'Исследование функции с помощью производной'),
  t('math.applied-formulas', 'math', 'Задачи с прикладным содержанием (по формуле)'),
  t('math.word-problems', 'math', 'Текстовые задачи: движение, работа, смеси, проценты'),
  t('math.function-graphs', 'math', 'Графики функций'),
  t('math.finance', 'math', 'Финансовая математика: вклады и кредиты'),
  t('math.modelling', 'math', 'Математическое моделирование и оптимизация'),
  t('math.equations-advanced', 'math', 'Уравнения (развёрнутый ответ)'),
  t('math.stereometry-proof', 'math', 'Стереометрия с доказательством'),
  t('math.inequalities', 'math', 'Неравенства (развёрнутый ответ)'),
  t('math.planimetry-proof', 'math', 'Планиметрия с доказательством'),
  t('math.parameters', 'math', 'Задачи с параметром'),
  t('math.number-theory', 'math', 'Числа и их свойства'),
  // ---- Russian ----
  t('russian.01-gap-word', 'russian', 'Пропущенное слово в тексте'),
  t('russian.02-word-meaning', 'russian', 'Лексическое значение слова'),
  t('russian.03-text-style', 'russian', 'Стилистический анализ текста'),
  t('russian.04-stress', 'russian', 'Орфоэпические нормы (ударение)'),
  t('russian.05-paronyms', 'russian', 'Паронимы'),
  t('russian.06-lexical-norms', 'russian', 'Лексические нормы'),
  t('russian.07-grammar-forms', 'russian', 'Морфологические нормы (формы слов)'),
  t('russian.08-syntax-norms', 'russian', 'Синтаксические нормы'),
  t('russian.09-root-vowels', 'russian', 'Правописание корней'),
  t('russian.10-prefixes', 'russian', 'Правописание приставок'),
  t('russian.11-suffixes', 'russian', 'Правописание суффиксов (кроме -Н-/-НН-)'),
  t('russian.12-verb-endings', 'russian', 'Личные окончания глаголов и суффиксы причастий'),
  t('russian.13-ne-ni', 'russian', 'Правописание НЕ и НИ'),
  t('russian.14-hyphen-together', 'russian', 'Слитное, дефисное, раздельное написание'),
  t('russian.15-n-nn', 'russian', 'Правописание -Н- и -НН-'),
  t('russian.16-homogeneous', 'russian', 'Однородные члены и сложносочинённое предложение'),
  t('russian.17-detached', 'russian', 'Обособленные члены предложения'),
  t('russian.18-parenthetical', 'russian', 'Вводные слова и обращения'),
  t('russian.19-complex-sentence', 'russian', 'Знаки в сложноподчинённом предложении'),
  t('russian.20-mixed-sentence', 'russian', 'Сложное предложение с разными видами связи'),
  t('russian.21-punctuation-analysis', 'russian', 'Пунктуационный анализ'),
  t('russian.22-expressive-means', 'russian', 'Средства выразительности'),
  t('russian.23-text-content', 'russian', 'Смысловой анализ текста'),
  t('russian.24-speech-types', 'russian', 'Функционально-смысловые типы речи'),
  t('russian.25-lexical-analysis', 'russian', 'Лексический анализ'),
  t('russian.26-sentence-links', 'russian', 'Средства связи предложений в тексте'),
  t('russian.27-essay', 'russian', 'Сочинение по прочитанному тексту'),
];

function bind(
  topicKey: string,
  relation: BindingRelation,
  status: SpecStatus,
  note?: string,
): ExamTopicBinding {
  return note ? { topicKey, relation, status, note } : { topicKey, relation, status };
}

/** Profile math in the 19-task model: ЕГЭ-2026 and the current ЕГЭ-2027
 * (FIPI specifications, compared position by position — identical). */
const MATH_19: readonly [number, 1 | 2, string, string][] = [
  [1, 1, 'Планиметрия', 'math.planimetry'],
  [2, 1, 'Векторы', 'math.vectors'],
  [3, 1, 'Стереометрия', 'math.stereometry'],
  [4, 1, 'Начала теории вероятностей', 'math.probability-basic'],
  [5, 1, 'Вероятности сложных событий', 'math.probability-rules'],
  [6, 1, 'Простейшие уравнения', 'math.equations-simple'],
  [7, 1, 'Вычисления и преобразования', 'math.expressions'],
  [8, 1, 'Производная и первообразная', 'math.derivative-graphs'],
  [9, 1, 'Задачи с прикладным содержанием', 'math.applied-formulas'],
  [10, 1, 'Текстовые задачи', 'math.word-problems'],
  [11, 1, 'Графики функций', 'math.function-graphs'],
  [12, 1, 'Наибольшее и наименьшее значение функции', 'math.derivative-investigation'],
  [13, 2, 'Уравнения', 'math.equations-advanced'],
  [14, 2, 'Стереометрическая задача', 'math.stereometry-proof'],
  [15, 2, 'Неравенства', 'math.inequalities'],
  [16, 2, 'Финансовая математика', 'math.finance'],
  [17, 2, 'Планиметрическая задача', 'math.planimetry-proof'],
  [18, 2, 'Задача с параметром', 'math.parameters'],
  [19, 2, 'Числа и их свойства', 'math.number-theory'],
];

const SPEC_2026 = 'Спецификация КИМ ЕГЭ-2026 по математике профильного уровня (ФИПИ).';
const SPEC_2027 =
  'Спецификация КИМ ЕГЭ-2027 (ФИПИ, 13.11.2026): позиция совпадает с ЕГЭ-2026 по номеру, требованиям, уровню и баллу.';
const PROJECT_2027 =
  'Проект КИМ ЕГЭ-2027 (август 2026), не принятый в окончательной редакции. Нумерация — по двум обзорам проекта (4ege.ru, ctege.info) и по сборнику Ященко-2027 (старая редакция).';

function math19(edition: 'ege-2026' | 'ege-2027'): ExamTaskSpec[] {
  const year = edition === 'ege-2026' ? 2026 : 2027;
  const note = edition === 'ege-2026' ? SPEC_2026 : SPEC_2027;
  return MATH_19.map(([number, part, title, key]) => ({
    subjectId: 'math',
    edition,
    year,
    number,
    part,
    title,
    topics: [bind(key, 'same', 'official', note)],
  }));
}

function project(
  number: number,
  part: 1 | 2,
  title: string,
  topics: readonly ExamTopicBinding[],
): ExamTaskSpec {
  return {
    subjectId: 'math',
    edition: 'ege-2027-project',
    year: 2027,
    number,
    part,
    title,
    topics,
  };
}
const P = (
  n: number,
  part: 1 | 2,
  title: string,
  key: string,
  relation: BindingRelation,
  note?: string,
) => project(n, part, title, [bind(key, relation, 'secondary', note ?? PROJECT_2027)]);

const PROJECT_MATH: readonly ExamTaskSpec[] = [
  P(1, 1, 'Планиметрия', 'math.planimetry', 'same'),
  P(2, 1, 'Векторы', 'math.vectors', 'same'),
  P(3, 1, 'Стереометрия', 'math.stereometry', 'same'),
  P(4, 1, 'Начала теории вероятностей', 'math.probability-basic', 'same'),
  P(5, 1, 'Вероятности сложных событий', 'math.probability-rules', 'same'),
  P(
    6,
    1,
    'Случайные величины',
    'math.random-variables',
    'new',
    'Отдельная позиция есть только в проекте. В актуальной редакции (и в 2026) случайные величины входят в требование 8 кодификатора, которое проверяется заданиями №4–5; в демоверсиях задач на них нет.',
  ),
  P(7, 1, 'Простейшие уравнения', 'math.equations-simple', 'same'),
  P(8, 1, 'Вычисления и преобразования', 'math.expressions', 'same'),
  project(9, 1, 'Производная и первообразная', [
    bind('math.derivative-graphs', 'same', 'secondary', PROJECT_2027),
    bind(
      'math.derivative-investigation',
      'part-of',
      'secondary',
      'В проекте отдельного задания на экстремум нет, исследование функции входит в №9. В актуальной редакции это снова отдельное задание №12.',
    ),
  ]),
  P(10, 1, 'Задачи с прикладным содержанием', 'math.applied-formulas', 'same'),
  P(11, 1, 'Текстовые задачи', 'math.word-problems', 'same'),
  P(12, 1, 'Графики функций', 'math.function-graphs', 'same'),
  P(
    13,
    1,
    'Финансовая математика (краткий ответ)',
    'math.finance',
    'format-changed',
    'В проекте — часть 1, краткий ответ, 1 балл. В актуальной редакции (и в 2026) это №16 части 2 с развёрнутым решением, 2 балла.',
  ),
  P(14, 2, 'Уравнения', 'math.equations-advanced', 'same'),
  P(15, 2, 'Стереометрическая задача', 'math.stereometry-proof', 'same'),
  P(16, 2, 'Неравенства', 'math.inequalities', 'same'),
  P(
    17,
    2,
    'Моделирование реальных ситуаций',
    'math.modelling',
    'new',
    'Есть только в проекте. В сборнике Ященко-2027 (старая редакция) — «Прикладные задачи на наибольшее и наименьшее значение».',
  ),
  P(18, 2, 'Планиметрическая задача', 'math.planimetry-proof', 'same'),
  P(19, 2, 'Задача с параметром', 'math.parameters', 'same'),
  P(20, 2, 'Числа и их свойства', 'math.number-theory', 'same'),
];

function russianSpecs(edition: 'ege-2026' | 'ege-2027'): ExamTaskSpec[] {
  const year = edition === 'ege-2026' ? 2026 : 2027;
  const note =
    edition === 'ege-2026'
      ? 'Номера 1–27 — по спецификации ЕГЭ-2026.'
      : 'Спецификация КИМ ЕГЭ-2027 по русскому языку (ФИПИ, 13.11.2026): 27 заданий, 50 баллов; в документе «Изменения в КИМ ЕГЭ 2027» — «Изменений нет».';
  return EXAM_TOPICS.filter((topic) => topic.subjectId === 'russian').map((topic, i) => ({
    subjectId: 'russian',
    edition,
    year,
    number: i + 1,
    part: i + 1 === 27 ? 2 : 1,
    title: topic.title,
    topics: [bind(topic.key, 'same', 'official', note)],
  }));
}

export const EXAM_TASK_SPECS: readonly ExamTaskSpec[] = [
  ...math19('ege-2027'),
  ...math19('ege-2026'),
  ...PROJECT_MATH,
  ...russianSpecs('ege-2027'),
  ...russianSpecs('ege-2026'),
];

/**
 * Topics in an edition's codifier that no task position names: studied
 * with the theory, shown in the catalog as «по кодификатору», never as the
 * theory of a number.
 */
export const CODIFIER_EXTRAS: readonly {
  edition: ExamEditionId;
  topicKey: string;
  note: string;
}[] = (['ege-2027', 'ege-2026'] as const).map((edition) => ({
  edition,
  topicKey: 'math.random-variables',
  note: 'Требование 8 кодификатора (проверяется заданиями №4–5) включает случайную величину, распределение, математическое ожидание, дисперсию и стандартное отклонение. В формулировках позиций и в демоверсии таких задач нет.',
}));

export function examEdition(id: string): ExamEdition | null {
  return EXAM_EDITIONS.find((e) => e.id === id) ?? null;
}

/** Editions defined for a subject, current first. */
export function examEditionsFor(subjectId: string): ExamEdition[] {
  return EXAM_EDITIONS.filter((e) => (e.subjects as readonly string[]).includes(subjectId));
}

/**
 * The edition whose numbering a task uses. The Ященко-2027 book follows the
 * not-adopted project; any other 2027 task follows the current edition; a
 * task without a year uses the 19-task numbering, which is the same in
 * ЕГЭ-2026 and the current ЕГЭ-2027.
 */
export function examEditionForTask(task: {
  subjectId: string;
  sourceYear?: number | null;
  source?: string | null;
}): ExamEditionId {
  if (task.subjectId === 'math' && task.source === YASHCHENKO_2027_PROJECT_SOURCE) {
    return 'ege-2027-project';
  }
  if (task.sourceYear === 2026) return 'ege-2026';
  return 'ege-2027';
}

/** The specification entry of one number in one edition, or null. */
export function examTaskSpec(
  subjectId: string,
  edition: ExamEditionId,
  number: number,
): ExamTaskSpec | null {
  return (
    EXAM_TASK_SPECS.find(
      (s) => s.subjectId === subjectId && s.edition === edition && s.number === number,
    ) ?? null
  );
}

/** Topic keys a number checks — `unclear` bindings are never returned. */
export function topicKeysForTask(
  subjectId: string,
  edition: ExamEditionId,
  number: number,
): string[] {
  const spec = examTaskSpec(subjectId, edition, number);
  return spec ? spec.topics.filter((b) => b.status !== 'unclear').map((b) => b.topicKey) : [];
}

export interface TopicPlacement {
  edition: ExamEditionId;
  number: number;
  relation: BindingRelation;
  status: SpecStatus;
}

/** Every (edition, number) that checks a topic, current edition first. */
export function examNumbersForTopic(topicKey: string): TopicPlacement[] {
  const order = EXAM_EDITIONS.map((e) => e.id);
  const out: TopicPlacement[] = [];
  for (const spec of EXAM_TASK_SPECS) {
    for (const b of spec.topics) {
      if (b.topicKey === topicKey && b.status !== 'unclear') {
        out.push({
          edition: spec.edition,
          number: spec.number,
          relation: b.relation,
          status: b.status,
        });
      }
    }
  }
  return out.sort(
    (a, b) => order.indexOf(a.edition) - order.indexOf(b.edition) || a.number - b.number,
  );
}
