/**
 * Which task numbers each exam year has, and which topic (rule) each number
 * checks — the bridge between a year's numbering and the theory.
 *
 * Theory is written once per topic (`ExamTopic.key`), never once per year:
 * a number binds to one or more topics, and the same topic can be bound
 * from several years under different numbers (ЕГЭ-2026 №6 and ЕГЭ-2027 №7
 * both check equations). Numbers are never renumbered to match another
 * year: each year keeps its own numbering, as the tasks table does
 * (`taskNumber` + `sourceYear`).
 *
 * Status of every binding is explicit, so nothing guessed passes for fact:
 * - `official` — read in the FIPI specification itself;
 * - `secondary` — FIPI documents could not be read from the development
 *   environment; the binding is confirmed by at least two independent
 *   reviews of the FIPI documents AND by the topics of the imported
 *   variants of that year. To be re-checked against the FIPI PDF.
 * - `unclear` — sources disagree or say nothing; never used for theory
 *   links until a person decides.
 *
 * Sources and the full comparison: docs/theory/EXAM-NUMBERING.md.
 */

export type ExamSubjectId = 'math' | 'russian';
export type SpecStatus = 'official' | 'secondary' | 'unclear';

/** How a number relates to the same topic in the other year. */
export type BindingRelation =
  /** Same content, possibly another number. */
  | 'same'
  /** New in this year. */
  | 'new'
  /** Same content, different format (part, answer type, points). */
  | 'format-changed'
  /** The topic is checked here only as part of a wider task. */
  | 'part-of';

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

const OFFICIAL_2026_MATH =
  'Спецификация КИМ ЕГЭ-2026 (ФИПИ), как в EXAM_SCORING_RULES ege-math-profile-2026@v1.';
const SECONDARY_2027 =
  'Проект КИМ ЕГЭ-2027 (ФИПИ, 28.08.2026) по двум независимым обзорам (4ege.ru, ctege.info) и темам 25 импортированных вариантов Ященко-2027. Сверить с PDF ФИПИ.';

function bind(
  topicKey: string,
  relation: BindingRelation,
  status: SpecStatus,
  note?: string,
): ExamTopicBinding {
  return note ? { topicKey, relation, status, note } : { topicKey, relation, status };
}

function math(
  year: number,
  number: number,
  part: 1 | 2,
  title: string,
  topics: readonly ExamTopicBinding[],
): ExamTaskSpec {
  return { subjectId: 'math', year, number, part, title, topics };
}

const M26 = (n: number, part: 1 | 2, title: string, key: string, note?: string) =>
  math(2026, n, part, title, [bind(key, 'same', 'official', note ?? OFFICIAL_2026_MATH)]);
const M27 = (
  n: number,
  part: 1 | 2,
  title: string,
  key: string,
  relation: BindingRelation,
  note?: string,
) => math(2027, n, part, title, [bind(key, relation, 'secondary', note ?? SECONDARY_2027)]);

export const EXAM_TASK_SPECS: readonly ExamTaskSpec[] = [
  // ---- ЕГЭ-2026, профильная математика: 19 заданий ----
  M26(1, 1, 'Планиметрия', 'math.planimetry'),
  M26(2, 1, 'Векторы', 'math.vectors'),
  M26(3, 1, 'Стереометрия', 'math.stereometry'),
  M26(4, 1, 'Начала теории вероятностей', 'math.probability-basic'),
  M26(5, 1, 'Вероятности сложных событий', 'math.probability-rules'),
  M26(6, 1, 'Простейшие уравнения', 'math.equations-simple'),
  M26(7, 1, 'Вычисления и преобразования', 'math.expressions'),
  M26(8, 1, 'Производная и первообразная', 'math.derivative-graphs'),
  M26(9, 1, 'Задачи с прикладным содержанием', 'math.applied-formulas'),
  M26(10, 1, 'Текстовые задачи', 'math.word-problems'),
  M26(11, 1, 'Графики функций', 'math.function-graphs'),
  M26(12, 1, 'Наибольшее и наименьшее значение функции', 'math.derivative-investigation'),
  M26(13, 2, 'Уравнения', 'math.equations-advanced'),
  M26(14, 2, 'Стереометрическая задача', 'math.stereometry-proof'),
  M26(15, 2, 'Неравенства', 'math.inequalities'),
  M26(16, 2, 'Финансовая математика', 'math.finance'),
  M26(17, 2, 'Планиметрическая задача', 'math.planimetry-proof'),
  M26(18, 2, 'Задача с параметром', 'math.parameters'),
  M26(19, 2, 'Числа и их свойства', 'math.number-theory'),

  // ---- ЕГЭ-2027 (проект), профильная математика: 20 заданий ----
  M27(1, 1, 'Планиметрия', 'math.planimetry', 'same'),
  M27(2, 1, 'Векторы', 'math.vectors', 'same'),
  M27(3, 1, 'Стереометрия', 'math.stereometry', 'same'),
  M27(4, 1, 'Начала теории вероятностей', 'math.probability-basic', 'same'),
  M27(5, 1, 'Вероятности сложных событий', 'math.probability-rules', 'same'),
  M27(6, 1, 'Случайные величины', 'math.random-variables', 'new'),
  M27(7, 1, 'Простейшие уравнения', 'math.equations-simple', 'same'),
  M27(8, 1, 'Вычисления и преобразования', 'math.expressions', 'same'),
  math(2027, 9, 1, 'Производная и первообразная', [
    bind('math.derivative-graphs', 'same', 'secondary', SECONDARY_2027),
    bind(
      'math.derivative-investigation',
      'part-of',
      'secondary',
      'Отдельного задания на экстремум (2026 №12) в проекте 2027 нет; исследование функции с помощью производной входит в содержание №9 (по обоим обзорам). Какие именно формулировки 2026 №12 встретятся в №9 — сверить с демоверсией.',
    ),
  ]),
  M27(10, 1, 'Задачи с прикладным содержанием', 'math.applied-formulas', 'same'),
  M27(11, 1, 'Текстовые задачи', 'math.word-problems', 'same'),
  M27(12, 1, 'Графики функций', 'math.function-graphs', 'same'),
  M27(
    13,
    1,
    'Финансовая математика (краткий ответ)',
    'math.finance',
    'format-changed',
    'В 2026 — №16 части 2 (развёрнутый ответ, 2 балла); в проекте 2027 — №13 части 1 (краткий ответ, 1 балл), в упрощённом виде. По обоим обзорам и сборнику Ященко-2027 (тема «Экономические задачи» у №13 во всех 25 вариантах).',
  ),
  M27(14, 2, 'Уравнения', 'math.equations-advanced', 'same'),
  M27(15, 2, 'Стереометрическая задача', 'math.stereometry-proof', 'same'),
  M27(16, 2, 'Неравенства', 'math.inequalities', 'same'),
  M27(
    17,
    2,
    'Моделирование реальных ситуаций',
    'math.modelling',
    'new',
    'Новое задание проекта 2027: модель реальной ситуации с алгеброй и анализом (оптимизация). В сборнике Ященко-2027 — «Прикладные задачи на наибольшее и наименьшее значение». Прямого аналога в 2026 нет.',
  ),
  M27(18, 2, 'Планиметрическая задача', 'math.planimetry-proof', 'same'),
  M27(19, 2, 'Задача с параметром', 'math.parameters', 'same'),
  M27(20, 2, 'Числа и их свойства', 'math.number-theory', 'same'),

  // ---- Русский язык: 27 заданий; нумерация 2026 и 2027 совпадает ----
  ...russianSpecs(2026, 'official'),
  ...russianSpecs(2027, 'secondary'),
];

function russianSpecs(year: number, status: SpecStatus): ExamTaskSpec[] {
  const note =
    status === 'official'
      ? 'Номера 1–27 — как в спецификации ЕГЭ-2026 и в 36 импортированных вариантах 2026.'
      : 'По сводному документу ФИПИ «Планируемые изменения в КИМ ЕГЭ 2027» (в пересказе обзоров) изменений в ЕГЭ по русскому языку нет; номера 1–27 совпадают с 2026 и с 54 импортированными вариантами Дощинского-2027. Сверить с PDF ФИПИ.';
  return EXAM_TOPICS.filter((topic) => topic.subjectId === 'russian').map((topic, i) => ({
    subjectId: 'russian',
    year,
    number: i + 1,
    part: i + 1 === 27 ? 2 : 1,
    title: topic.title,
    topics: [bind(topic.key, 'same', status, note)],
  }));
}

/** The specification entry of one number in one exam year, or null. */
export function examTaskSpec(subjectId: string, year: number, number: number): ExamTaskSpec | null {
  return (
    EXAM_TASK_SPECS.find(
      (s) => s.subjectId === subjectId && s.year === year && s.number === number,
    ) ?? null
  );
}

/** Topic keys a number checks — `unclear` bindings are never returned. */
export function topicKeysForTask(subjectId: string, year: number, number: number): string[] {
  const spec = examTaskSpec(subjectId, year, number);
  return spec ? spec.topics.filter((b) => b.status !== 'unclear').map((b) => b.topicKey) : [];
}

/** Every (year, number) that checks a topic — for the «ЕГЭ-2027 №7 · ЕГЭ-2026 №6» line. */
export function examNumbersForTopic(
  topicKey: string,
): { year: number; number: number; relation: BindingRelation; status: SpecStatus }[] {
  const out: { year: number; number: number; relation: BindingRelation; status: SpecStatus }[] = [];
  for (const spec of EXAM_TASK_SPECS) {
    for (const b of spec.topics) {
      if (b.topicKey === topicKey && b.status !== 'unclear') {
        out.push({ year: spec.year, number: spec.number, relation: b.relation, status: b.status });
      }
    }
  }
  return out.sort((a, b) => b.year - a.year || a.number - b.number);
}

export function examYears(subjectId: string): number[] {
  return [
    ...new Set(EXAM_TASK_SPECS.filter((s) => s.subjectId === subjectId).map((s) => s.year)),
  ].sort();
}
