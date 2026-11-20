/**
 * Deterministic criticality of fact-check issues (SEO Center, stage 2.1).
 *
 * The model files every issue under one category from a closed list (its
 * structured output enforces the enum) and may suggest a severity. The
 * server ignores that suggestion where it matters and applies fixed rules:
 *
 *   1. A category from FACT_CATEGORIES_CRITICAL is critical — always,
 *      whatever severity the model proposed.
 *   2. A category from FACT_CATEGORIES_MINOR is minor — unless the claim
 *      itself states a number or a date (digits, a month name): a «style»
 *      note about «2 балла» or «до 1 июня» is not trusted as minor and
 *      becomes ambiguous.
 *   3. A missing, unknown or «other» category is ambiguous.
 *
 * critical + contradicted → blocks everything, a manual approval included;
 * critical + unverified and every ambiguous issue → block automatic
 * publication (the owner can approve manually after checking);
 * minor → recorded, does not by itself block.
 *
 * Rule 2 is the only text check, and it can only move an issue towards
 * «blocked» (never towards «allowed»): a false positive costs a manual look,
 * never a wrong publication.
 */

export const FACT_CATEGORIES_CRITICAL = [
  /** Даты экзаменов, расписание, сроки дополнительных дней. */
  'exam_dates',
  /** Структура экзамена: части, типы заданий, формат ответа. */
  'exam_structure',
  /** Количество заданий (в варианте, в части). */
  'task_count',
  /** Первичные баллы за задания и за экзамен. */
  'primary_scores',
  /** Тестовые баллы, шкала перевода, минимальные и проходные пороги. */
  'test_scores',
  /** Критерии оценивания развёрнутых ответов. */
  'grading_criteria',
  /** Правила проведения: что можно брать, длительность, апелляции, пересдачи. */
  'exam_rules',
  /** Нормативные документы: приказы, спецификации, кодификаторы, демоверсии. */
  'regulations',
  /** Сроки подачи заявлений, результатов, другие сроки. */
  'deadlines',
  /** Любой другой числовой показатель (проценты, статистика, количества). */
  'numeric_fact',
  /** Содержание предмета: формулы, правила, решения, определения. */
  'subject_content',
] as const;

export const FACT_CATEGORIES_MINOR = [
  /** Неточная формулировка без изменения смысла. */
  'wording',
  /** Стиль, вода, повторы. */
  'style',
] as const;

/** Everything the model may answer; «other» = it could not file the issue. */
export const FACT_CATEGORIES = [
  ...FACT_CATEGORIES_CRITICAL,
  ...FACT_CATEGORIES_MINOR,
  'other',
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export type FactCriticality = 'critical' | 'minor' | 'ambiguous';

export interface ClassifiedIssue {
  claim: string;
  category: string;
  criticality: FactCriticality;
  status: 'contradicted' | 'unverified';
  /** Which server rule decided (for the admin and the logs). */
  rule: 'critical_category' | 'minor_category' | 'minor_with_number' | 'unknown_category';
  /** What the model suggested — kept for comparison, never used to decide. */
  modelSeverity: string | null;
}

const CRITICAL = new Set<string>(FACT_CATEGORIES_CRITICAL);
const MINOR = new Set<string>(FACT_CATEGORIES_MINOR);

/** A month name as a word start («мая», «июне»; not «самая», «маятник»). */
const MONTHS =
  /(?<![а-яё])(январ|феврал|март|апрел|ма[йяе](?![а-яё])|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;

/** The claim states a number or a date. */
export function statesNumberOrDate(text: string): boolean {
  return /\d/.test(text) || MONTHS.test(text);
}

export function classifyFactIssue(i: {
  claim: string;
  category?: string | null;
  severity?: string | null;
  status?: string | null;
}): ClassifiedIssue {
  const category = typeof i.category === 'string' ? i.category : '';
  // Fail-closed: an unknown status is treated as a contradiction.
  const status: ClassifiedIssue['status'] =
    i.status === 'unverified' ? 'unverified' : 'contradicted';
  const base = {
    claim: i.claim.slice(0, 500),
    category,
    status,
    modelSeverity: i.severity ?? null,
  };
  if (CRITICAL.has(category))
    return { ...base, criticality: 'critical', rule: 'critical_category' };
  if (MINOR.has(category)) {
    return statesNumberOrDate(i.claim)
      ? { ...base, criticality: 'ambiguous', rule: 'minor_with_number' }
      : { ...base, criticality: 'minor', rule: 'minor_category' };
  }
  return { ...base, criticality: 'ambiguous', rule: 'unknown_category' };
}
