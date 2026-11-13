import { EXAM_TOPICS, examNumbersForTopic, type ExamTopic } from '@zybrilka/shared';

/**
 * Profile-math theory (docs/theory/AUDIT-AND-PLAN.md): one material per
 * topic of packages/shared/src/examSpecs.ts, never one per exam year. A
 * task reaches it through its year and number (`topicKeysForTask`), so
 * ЕГЭ-2027 №13 and ЕГЭ-2026 №16 open the same «Финансовая математика».
 *
 * Texts: src/content/theory/math/<file>.md, loaded lazily. A topic with
 * no file yet stays in the catalog marked «готовится» — never an empty
 * page pretending to be theory.
 */

export interface TheorySource {
  title: string;
  /** Only real, opened addresses; a book or a document without one has none. */
  url?: string;
  /** What this source confirms in the text. */
  confirms: string;
}

export interface MathTheoryMaterial {
  topicKey: string;
  /** File name in src/content/theory/math (without `.md`). */
  file: string;
  sources: readonly TheorySource[];
  /** Shown above the text while a part still waits for the FIPI documents. */
  caution?: string;
}

const FIPI_PAGE: TheorySource = {
  title: 'ФИПИ — демоверсии, спецификации, кодификаторы ЕГЭ 2026 и 2027',
  url: 'https://fipi.ru/ege/demoversii-specifikacii-kodifikatory',
  confirms:
    'Наличие документов 2026 и 2027 годов. Сами PDF (doc.fipi.ru) из среды подготовки не открылись — содержание сверено по обзорам ниже.',
};
const REVIEW_4EGE: TheorySource = {
  title: '4ЕГЭ — изменения в профильной математике ЕГЭ 2027 (таблица по спецификации)',
  url: 'https://4ege.ru/matematika/80738-izmenenija-v-profilnoj-matematike-ege-2027-novye-zadanija-i-novaja-struktura.html',
  confirms:
    'Номера, баллы и проверяемое содержание заданий 2027 года и их соответствие номерам 2026.',
};
const REVIEW_CTEGE: TheorySource = {
  title: 'ctege.info — изменения ЕГЭ 2027 по профильной математике',
  url: 'https://ctege.info/ege-2027/izmeneniya-ege-2027-po-profilnoj-matematike.html',
  confirms: 'Новые задания №6 и №17, перенос финансовой задачи из №16 (2026) в №13 (2027).',
};
const PROB_TEXTBOOK: TheorySource = {
  title:
    'Высоцкий И. Р., Ященко И. В. Математика. Вероятность и статистика. 10–11 классы. Базовый уровень. — М.: Просвещение',
  confirms:
    'Опорный школьный учебник по теме (случайная величина, ожидание, дисперсия). При подготовке текста не открывался: формулы и все числа примеров проверены отдельным вычислением.',
};

export const mathTheory: readonly MathTheoryMaterial[] = [
  {
    topicKey: 'math.random-variables',
    file: 'random-variables',
    sources: [REVIEW_4EGE, REVIEW_CTEGE, PROB_TEXTBOOK, FIPI_PAGE],
    caution:
      'Задание новое (проект ЕГЭ-2027). Формулировки задач уточнятся по демоверсии и открытому банку ФИПИ; раздел о непрерывных распределениях будет сверен первым.',
  },
  {
    topicKey: 'math.finance',
    file: 'finance',
    sources: [REVIEW_4EGE, REVIEW_CTEGE, FIPI_PAGE],
  },
];

/** Every math topic in exam order of the latest year, with its material (or null). */
export function mathTheoryCatalog(): { topic: ExamTopic; material: MathTheoryMaterial | null }[] {
  return EXAM_TOPICS.filter((t) => t.subjectId === 'math').map((topic) => ({
    topic,
    material: mathTheory.find((m) => m.topicKey === topic.key) ?? null,
  }));
}

export function mathMaterialFor(topicKey: string): MathTheoryMaterial | null {
  return mathTheory.find((m) => m.topicKey === topicKey) ?? null;
}

/** «ЕГЭ-2027 №13 · ЕГЭ-2026 №16» — where a topic is checked. */
export function examNumbersLabel(topicKey: string): string {
  return examNumbersForTopic(topicKey)
    .map((x) => `ЕГЭ-${x.year} №${x.number}`)
    .join(' · ');
}

const loaders = import.meta.glob<string>('../../content/theory/math/*.md', {
  query: '?raw',
  import: 'default',
});

export async function loadMathTheory(file: string): Promise<string> {
  const load = loaders[`../../content/theory/math/${file}.md`];
  if (!load) throw new Error(`math theory not found: ${file}`);
  return load();
}

/** All files on disk — for the integrity test. */
export function mathTheoryFiles(): string[] {
  return Object.keys(loaders).map((path) => path.replace(/^.*\/(.+)\.md$/, '$1'));
}
