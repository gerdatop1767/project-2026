import { EXAM_TASK_SPECS } from '@zybrilka/shared';
import { libraryItems, type LibraryItem } from '../data/library/libraryData.js';
import { russianTheory, type TheoryTask } from '../data/theory/russianTheoryData.js';

/**
 * Learning-centre pages for search engines (docs/seo/SEO-REPORT.md): the
 * centre, the theory of every EGE task number, every material and every
 * strategy — each with its own readable address, title, description and
 * breadcrumb parent. Built from the same manifests the screens read, so
 * a new material or number gets its page, sitemap entry and prerendered
 * <head> without anything kept by hand.
 */

/** The math numbering whose theory pages are indexed (ЕГЭ-2027 = 2026). */
export const SEO_MATH_EDITION = 'ege-2027';

export interface LearningSeoPage {
  path: string;
  title: string;
  description: string;
  name: string;
  parent: string;
  /** schema.org type of the main entity, for item pages. */
  resource?: 'LearningResource';
}

const BRAND = ' — Zybrilka';

export function russianTheoryPath(n: number): string {
  return `/theory/russian/${n}`;
}
export function mathTheoryPath(n: number): string {
  return `/theory/math/${n}`;
}
export function libraryItemPath(item: Pick<LibraryItem, 'section' | 'id'>): string {
  return `/${item.section}/${item.id}`;
}

function kindsPhrase(task: TheoryTask): string {
  const kinds = new Set(task.materials.map((m) => m.kind));
  const parts = [
    kinds.has('theory') && 'конспект с алгоритмом и типичными ошибками',
    kinds.has('reference') && 'справочный список',
    kinds.has('practice') && 'практика с ответами',
  ].filter(Boolean);
  return parts.join(', ');
}

export const mathTheorySpecs = EXAM_TASK_SPECS.filter(
  (s) => s.subjectId === 'math' && s.edition === SEO_MATH_EDITION,
);

/** Titles stay within ~70 characters: « — теория» only when it fits. */
function withTheory(title: string): string {
  return title.length <= 62 ? `${title} — теория` : title;
}

function clip(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export const LEARNING_PAGES: readonly LearningSeoPage[] = [
  {
    path: '/learning',
    title: 'Учебный центр ЕГЭ: теория, материалы и стратегии' + BRAND,
    description:
      'Учебный центр Zybrilka: теория по всем номерам ЕГЭ по русскому языку и профильной математике, справочные материалы, шпаргалки и стратегии подготовки.',
    name: 'Учебный центр',
    parent: '/',
  },
  {
    path: '/theory',
    title: 'Теория к заданиям ЕГЭ по русскому языку №1–27' + BRAND,
    description:
      'Теория по русскому языку для каждого задания ЕГЭ с №1 по №27: конспекты, алгоритмы, справочные списки и практика с ответами. Правила сверены с ФИПИ.',
    name: 'Теория по русскому языку',
    parent: '/learning',
  },
  {
    path: '/theory/math',
    title: 'Теория к заданиям ЕГЭ по профильной математике №1–19' + BRAND,
    description:
      'Теория по профильной математике для каждого задания ЕГЭ с №1 по №19: формулы, методы решения, разобранные примеры, критерии второй части и типичные ошибки.',
    name: 'Теория по математике',
    parent: '/learning',
  },
  ...[...russianTheory]
    .filter((t) => t.materials.length > 0)
    .sort((a, b) => a.taskNumber - b.taskNumber)
    .map((t): LearningSeoPage => ({
      path: russianTheoryPath(t.taskNumber),
      title: withTheory(`№${t.taskNumber} ЕГЭ по русскому языку: ${t.title}`),
      description: clip(
        `Задание №${t.taskNumber} ЕГЭ по русскому языку «${t.title}»: ${kindsPhrase(t)}. Разбор по формату ЕГЭ-2026–2027.`,
      ),
      name: `№${t.taskNumber}. ${t.title}`,
      parent: '/theory',
      resource: 'LearningResource',
    })),
  ...mathTheorySpecs.map((s): LearningSeoPage => ({
    path: mathTheoryPath(s.number),
    title: withTheory(`№${s.number} ЕГЭ по профильной математике: ${s.title}`),
    description: clip(
      s.part === 2
        ? `Задание №${s.number} ЕГЭ по профильной математике «${s.title}»: методы решения, оформление и критерии оценивания второй части, разобранные задачи с ответами.`
        : `Задание №${s.number} ЕГЭ по профильной математике «${s.title}»: теория, формулы, разобранные примеры и типичные ошибки. Нумерация ЕГЭ-2027 и 2026.`,
    ),
    name: `№${s.number}. ${s.title}`,
    parent: '/theory/math',
    resource: 'LearningResource',
  })),
  ...libraryItems.map((item): LearningSeoPage => ({
    path: libraryItemPath(item),
    title: clip(
      `${item.title}${item.section === 'strategies' ? ' — стратегия ЕГЭ' : ' — ЕГЭ'}${BRAND}`,
      90,
    ),
    description: clip(item.description),
    name: item.title,
    parent: item.section === 'strategies' ? '/strategies' : '/materials',
    resource: 'LearningResource',
  })),
];
