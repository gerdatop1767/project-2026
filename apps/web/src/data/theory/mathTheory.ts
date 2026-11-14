import {
  CODIFIER_EXTRAS,
  EXAM_TOPICS,
  examNumbersForTopic,
  type ExamEditionId,
  type ExamTopic,
} from '@zybrilka/shared';

/**
 * Profile-math theory (docs/theory/AUDIT-AND-PLAN.md): one material per
 * topic of packages/shared/src/examSpecs.ts, never one per exam year. A
 * task reaches it through its edition and number (`topicKeysForTask`), so
 * ЕГЭ-2027/2026 №16 and the old Ященко-2027 №13 open the same «Финансовая математика».
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

const FIPI_SPEC_2027: TheorySource = {
  title: 'ФИПИ — спецификация, кодификатор и демоверсия ЕГЭ-2027 по математике (13.11.2026)',
  url: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/ma_11_2027.zip',
  confirms:
    'Номера, части и баллы заданий ЕГЭ-2027 (19 заданий, 32 балла); проверяемые требования кодификатора.',
};
const FIPI_SPEC_2026: TheorySource = {
  title: 'ФИПИ — спецификация, кодификатор и демоверсия ЕГЭ-2026 по математике',
  url: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2026/ma_11_2026.zip',
  confirms: 'Номера, части и баллы заданий ЕГЭ-2026 — совпадают с 2027 годом.',
};
const FIPI_CHANGES_2027: TheorySource = {
  title: 'ФИПИ — «Изменения в КИМ ЕГЭ 2027 года»',
  url: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/Izmeneniya_KIM_EGE_2027.pdf',
  confirms: 'Для профильной математики — «Изменений нет».',
};
const REVIEW_PROJECT_2027: TheorySource = {
  title: 'ctege.info — обзор проекта КИМ ЕГЭ-2027 (август 2026)',
  url: 'https://ctege.info/ege-2027/izmeneniya-ege-2027-po-profilnoj-matematike.html',
  confirms:
    'Нумерация непринятого проекта (20 заданий), по которому составлен старый сборник Ященко-2027.',
};
const PROB_TEXTBOOK: TheorySource = {
  title:
    'Высоцкий И. Р., Ященко И. В. Математика. Вероятность и статистика. 10–11 классы. Базовый уровень. — М.: Просвещение',
  confirms:
    'Опорный школьный учебник по теме (случайная величина, ожидание, дисперсия). При подготовке текста не открывался: формулы и все числа примеров проверены отдельным вычислением.',
};

/** Official placement sources shared by every math topic. */
const SPEC_SOURCES: readonly TheorySource[] = [FIPI_SPEC_2027, FIPI_SPEC_2026, FIPI_CHANGES_2027];

export const mathTheory: readonly MathTheoryMaterial[] = [
  {
    topicKey: 'math.random-variables',
    file: 'random-variables',
    sources: [...SPEC_SOURCES, PROB_TEXTBOOK, REVIEW_PROJECT_2027],
  },
  {
    topicKey: 'math.finance',
    file: 'finance',
    sources: [...SPEC_SOURCES, REVIEW_PROJECT_2027],
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

/**
 * Where a topic is checked, edition by edition: «ЕГЭ-2027 и ЕГЭ-2026 №16 ·
 * старая редакция Ященко-2027 №13». The current 2027 and 2026 are merged
 * only when their numbers coincide (they do for every number today).
 */
export function examNumbersLabel(topicKey: string): string {
  const at = examNumbersForTopic(topicKey);
  const num = (edition: ExamEditionId) =>
    at.filter((x) => x.edition === edition).map((x) => x.number);
  const parts: string[] = [];
  const now = num('ege-2027');
  const before = num('ege-2026');
  if (now.length > 0 && now.join() === before.join()) {
    parts.push(`ЕГЭ-2027 и ЕГЭ-2026 №${now.join(', №')}`);
  } else {
    if (now.length > 0) parts.push(`ЕГЭ-2027 №${now.join(', №')}`);
    if (before.length > 0) parts.push(`ЕГЭ-2026 №${before.join(', №')}`);
  }
  const old = num('ege-2027-project');
  if (old.length > 0) parts.push(`Ященко-2027, старая редакция №${old.join(', №')}`);
  return parts.join(' · ');
}

/** Topics an edition's codifier includes without a task position of their own. */
export function codifierExtras(edition: ExamEditionId) {
  return CODIFIER_EXTRAS.filter((x) => x.edition === edition);
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
