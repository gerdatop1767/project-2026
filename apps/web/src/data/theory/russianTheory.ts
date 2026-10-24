/**
 * The one source of the Russian-language theory (docs/THEORY.md): every
 * material is linked to a subject and an EGE task number — the same
 * `subjectId` + `taskNumber` every task row carries — so the catalog
 * («Теория», «Полезные материалы») and the task screen's «Правило» read
 * the same entry. Topic slugs are not used as the key: imported variants
 * name the same task's topic differently (e.g. №21 «dash-rules»,
 * «colon-rules», «punctuation-rules»), while the number is stable.
 *
 * The texts are the owner-provided archives, kept as Markdown files in
 * `src/content/theory/russian` (one file per material, loaded lazily) —
 * only the corrections listed in docs/THEORY.md were made.
 */

export type TheoryMaterialKind = 'theory' | 'practice' | 'reference';

export interface TheoryMaterial {
  /** Also the file name in src/content/theory/russian (without `.md`). */
  id: string;
  kind: TheoryMaterialKind;
  title: string;
  /** Shown above the text: why this material needs care. */
  caution?: string;
}

/** Hand-made visual schemes (ui/Theory/TheoryDiagram) — built from the
 * archive's own examples, with all text as real interface text. */
export type TheoryDiagramId = 'stress' | 'junction' | 'participle';

export interface TheoryTask {
  subjectId: 'russian';
  taskNumber: number;
  title: string;
  group: TheoryGroupId;
  materials: readonly TheoryMaterial[];
  diagram?: TheoryDiagramId;
}

export type TheoryGroupId = 'text' | 'norms' | 'spelling' | 'punctuation' | 'essay';

export const theoryGroups: readonly { id: TheoryGroupId; title: string }[] = [
  { id: 'text', title: 'Работа с текстом' },
  { id: 'norms', title: 'Языковые нормы' },
  { id: 'spelling', title: 'Орфография' },
  { id: 'punctuation', title: 'Пунктуация' },
  { id: 'essay', title: 'Сочинение' },
];

/** The exam the archives were written for (their own label). */
export const THEORY_EXAM_YEAR = 2026;

/** Official sources the archives cite (ИСТОЧНИКИ.md of each archive). */
export const theorySources: readonly { title: string; url: string }[] = [
  {
    title: 'ФИПИ — демоверсии, спецификации, кодификаторы',
    url: 'https://fipi.ru/ege/demoversii-specifikacii-kodifikatory',
  },
  {
    title: 'ФИПИ — открытый банк заданий ЕГЭ',
    url: 'https://fipi.ru/ege/otkrytyy-bank-zadaniy-ege',
  },
  {
    title: 'Навигатор ФИПИ 2026 — фонетика и орфоэпия',
    url: 'https://doc.fipi.ru/navigator-podgotovki/navigator-ege/2026/ru-1-fonetika.pdf',
  },
  {
    title: 'Навигатор ФИПИ 2026 — лексика и фразеология',
    url: 'https://doc.fipi.ru/navigator-podgotovki/navigator-ege/2026/ru-2-leksika-i-frazeologija.pdf',
  },
  {
    title: 'Навигатор ФИПИ 2026 — орфография',
    url: 'https://doc.fipi.ru/navigator-podgotovki/navigator-ege/2026/ru-5-orfografija.pdf',
  },
  {
    title: 'Навигатор ФИПИ 2026 — пунктуация',
    url: 'https://doc.fipi.ru/navigator-podgotovki/navigator-ege/2026/ru-6-punktuacija.pdf',
  },
];

const listCaution =
  'Список перенесён из прежних материалов и ещё не сверен построчно с актуальным PDF ФИПИ.';

const theory = (n: number, title = 'Конспект'): TheoryMaterial => ({
  id: `task-${String(n).padStart(2, '0')}-theory`,
  kind: 'theory',
  title,
});
const practice = (n: number, title = 'Практика с ответами'): TheoryMaterial => ({
  id: `task-${String(n).padStart(2, '0')}-practice`,
  kind: 'practice',
  title,
});

export const russianTheory: readonly TheoryTask[] = [
  {
    subjectId: 'russian',
    taskNumber: 1,
    title: 'Пропущенное слово в тексте',
    group: 'text',
    materials: [],
  },
  {
    subjectId: 'russian',
    taskNumber: 2,
    title: 'Лексическое значение слова',
    group: 'text',
    materials: [],
  },
  {
    subjectId: 'russian',
    taskNumber: 3,
    title: 'Стилистический анализ текста',
    group: 'text',
    materials: [theory(3), practice(3)],
  },
  {
    subjectId: 'russian',
    taskNumber: 4,
    title: 'Орфоэпические нормы',
    group: 'norms',
    diagram: 'stress',
    materials: [
      theory(4),
      {
        id: 'task-04-reference',
        kind: 'reference',
        title: 'Орфоэпический список',
        caution: listCaution,
      },
      practice(4, 'Практика'),
    ],
  },
  {
    subjectId: 'russian',
    taskNumber: 5,
    title: 'Паронимы',
    group: 'norms',
    materials: [
      theory(5),
      {
        id: 'task-05-reference',
        kind: 'reference',
        title: 'Список паронимов',
        caution: listCaution,
      },
      practice(5, 'Практика'),
    ],
  },
  {
    subjectId: 'russian',
    taskNumber: 6,
    title: 'Лексические нормы',
    group: 'norms',
    materials: [theory(6), practice(6, 'Практика')],
  },
  {
    subjectId: 'russian',
    taskNumber: 7,
    title: 'Грамматические нормы',
    group: 'norms',
    materials: [theory(7), practice(7, 'Практика')],
  },
  {
    subjectId: 'russian',
    taskNumber: 8,
    title: 'Синтаксические нормы',
    group: 'norms',
    materials: [theory(8), practice(8, 'Практика')],
  },
  {
    subjectId: 'russian',
    taskNumber: 9,
    title: 'Гласные в корне',
    group: 'spelling',
    materials: [theory(9), practice(9, 'Практика')],
  },
  {
    subjectId: 'russian',
    taskNumber: 10,
    title: 'Приставки, Ъ/Ь, И/Ы после приставок',
    group: 'spelling',
    materials: [theory(10), practice(10, 'Практика')],
  },
  {
    subjectId: 'russian',
    taskNumber: 11,
    title: 'Суффиксы разных частей речи',
    group: 'spelling',
    materials: [theory(11), practice(11)],
  },
  {
    subjectId: 'russian',
    taskNumber: 12,
    title: 'Личные окончания глаголов и суффиксы причастий',
    group: 'spelling',
    materials: [theory(12), practice(12)],
  },
  {
    subjectId: 'russian',
    taskNumber: 13,
    title: 'НЕ и НИ',
    group: 'spelling',
    materials: [theory(13), practice(13)],
  },
  {
    subjectId: 'russian',
    taskNumber: 14,
    title: 'Слитное, дефисное и раздельное написание',
    group: 'spelling',
    materials: [theory(14), practice(14)],
  },
  {
    subjectId: 'russian',
    taskNumber: 15,
    title: 'Н и НН',
    group: 'spelling',
    materials: [theory(15), practice(15)],
  },
  {
    subjectId: 'russian',
    taskNumber: 16,
    title: 'Однородные члены и ССП',
    group: 'punctuation',
    materials: [theory(16), practice(16)],
  },
  {
    subjectId: 'russian',
    taskNumber: 17,
    title: 'Обособленные члены предложения',
    group: 'punctuation',
    diagram: 'participle',
    materials: [theory(17), practice(17)],
  },
  {
    subjectId: 'russian',
    taskNumber: 18,
    title: 'Вводные слова и обращения',
    group: 'punctuation',
    materials: [theory(18), practice(18)],
  },
  {
    subjectId: 'russian',
    taskNumber: 19,
    title: 'Знаки в сложноподчинённом предложении',
    group: 'punctuation',
    diagram: 'junction',
    materials: [theory(19), practice(19)],
  },
  {
    subjectId: 'russian',
    taskNumber: 20,
    title: 'Сложное предложение с разными видами связи',
    group: 'punctuation',
    diagram: 'junction',
    materials: [
      theory(20),
      { id: 'task-20-theory-b', kind: 'theory', title: 'Конспект: стык союзов и союз И' },
      practice(20),
      { id: 'task-20-practice-b', kind: 'practice', title: 'Практика: позиции запятых' },
    ],
  },
  {
    subjectId: 'russian',
    taskNumber: 21,
    title: 'Пунктуационный анализ',
    group: 'punctuation',
    materials: [theory(21), practice(21)],
  },
  {
    subjectId: 'russian',
    taskNumber: 22,
    title: 'Средства выразительности',
    group: 'text',
    materials: [theory(22), practice(22)],
  },
  {
    subjectId: 'russian',
    taskNumber: 23,
    title: 'Анализ содержания текста',
    group: 'text',
    materials: [theory(23), practice(23)],
  },
  {
    subjectId: 'russian',
    taskNumber: 24,
    title: 'Типы речи',
    group: 'text',
    materials: [theory(24), practice(24)],
  },
  {
    subjectId: 'russian',
    taskNumber: 25,
    title: 'Лексический анализ',
    group: 'text',
    materials: [theory(25), practice(25)],
  },
  {
    subjectId: 'russian',
    taskNumber: 26,
    title: 'Средства связи предложений',
    group: 'text',
    materials: [theory(26), practice(26)],
  },
  {
    subjectId: 'russian',
    taskNumber: 27,
    title: 'Сочинение по прочитанному тексту',
    group: 'essay',
    materials: [theory(27), practice(27, 'Практика: план сочинения')],
  },
];

/** Subjects that have a theory catalog. Others have none — no empty stubs. */
export function hasTheory(subjectId: string): boolean {
  return subjectId === 'russian';
}

/** The entry for a task, or null when the subject has no catalog or the
 * number is unknown. An entry with no materials means «материала пока нет». */
export function theoryForTask(subjectId: string, taskNumber: number): TheoryTask | null {
  if (!hasTheory(subjectId)) return null;
  return russianTheory.find((t) => t.taskNumber === taskNumber) ?? null;
}

const loaders = import.meta.glob<string>('../../content/theory/russian/*.md', {
  query: '?raw',
  import: 'default',
});

/** Loads one material's Markdown (its own chunk — never in the main bundle). */
export async function loadTheoryMaterial(id: string): Promise<string> {
  const load = loaders[`../../content/theory/russian/${id}.md`];
  if (!load) throw new Error(`theory material not found: ${id}`);
  return load();
}

/** All material ids that have a file — for the integrity test. */
export function theoryMaterialFiles(): string[] {
  return Object.keys(loaders).map((path) => path.replace(/^.*\/(.+)\.md$/, '$1'));
}
