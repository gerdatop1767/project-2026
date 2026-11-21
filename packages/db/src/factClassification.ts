/**
 * Fact-check issue classification (SEO Center, stage 2.1) — a conservative
 * policy until the full Fact-Checking Engine (stage 2.2+).
 *
 * The model's word is never the final one about criticality:
 *
 *   • Every FACTUAL issue blocks automatic publication, whatever category or
 *     severity the model gave it. The category only decides what a manual
 *     approval may do:
 *       - critical category + contradicted → nothing can override it;
 *       - anything else (critical unverified, minor, unknown) → the owner may
 *         approve manually after checking.
 *     A «wording» label cannot turn «ЕГЭ начинается на два дня раньше» into
 *     a non-blocking note: as a factual issue it blocks auto mode anyway.
 *
 *   • A STYLE note is the only kind that does not block — and only when two
 *     independent signals agree it is purely stylistic:
 *       1. a separate triage call (another prompt, cheap model) answers
 *          «style_only» for that note — no answer, «unsure» or
 *          «may_change_facts» = not confirmed;
 *       2. the server finds no fact markers in it (numbers, dates, quantity
 *          or time comparisons, «changed / moved / cancelled», exam terms
 *          such as threshold, score, criteria, deadline).
 *     Either signal missing → ambiguous → blocks automatic publication.
 *
 * The marker check can only move a note towards «blocked», never towards
 * «allowed»: a false positive costs a manual look, never a wrong publication.
 * It is never the only signal that lets a note through.
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
  rule: 'critical_category' | 'minor_category' | 'minor_with_marker' | 'unknown_category';
  /** What the model suggested — kept for comparison, never used to decide. */
  modelSeverity: string | null;
}

const CRITICAL = new Set<string>(FACT_CATEGORIES_CRITICAL);
const MINOR = new Set<string>(FACT_CATEGORIES_MINOR);

const W = '(?<![а-яё])';
/** Fact markers: each a kind of statement a style note must not contain. */
const MARKERS: [string, RegExp][] = [
  ['number', /\d/],
  [
    'month',
    new RegExp(
      `${W}(январ|феврал|март|апрел|ма[йяе](?![а-яё])|июн|июл|август|сентябр|октябр|ноябр|декабр)`,
      'i',
    ),
  ],
  [
    'number_word',
    new RegExp(
      `${W}(один|одна|одно|одну|два|две|двух|двум|три|трёх|трех|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|сто|двести|триста|тысяч[аиеу]?|половин[аеуы]?|треть|вдвое|втрое|вчетверо|дважды|трижды)(?![а-яё])`,
      'i',
    ),
  ],
  ['time_shift', new RegExp(`${W}(раньше|позже|позднее|ранее|дольше|продл)`, 'i')],
  ['change', new RegExp(`${W}(измен|перенес|перенос|отмен|ввел|введ|появил)`, 'i')],
  [
    'exam_term',
    new RegExp(
      `${W}(порог|балл|критери|срок|дат[аеуы](?![а-яё])|расписан|задани|экзамен|егэ|огэ|фипи|рособрнадзор|демоверс|спецификац|кодификатор|приказ|минимальн|проходн|пересдач|апелляц|резервн|досрочн|длительн|продолжительн|минут|час(?![а-яё])|часа|часов)`,
      'i',
    ),
  ],
];

/** Fact markers found in a text (empty = none). Escalation only. */
export function factMarkers(text: string): string[] {
  return MARKERS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

/** The claim states a number or a date. */
export function statesNumberOrDate(text: string): boolean {
  const m = factMarkers(text);
  return m.includes('number') || m.includes('month');
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
    return factMarkers(i.claim).length > 0
      ? { ...base, criticality: 'ambiguous', rule: 'minor_with_marker' }
      : { ...base, criticality: 'minor', rule: 'minor_category' };
  }
  return { ...base, criticality: 'ambiguous', rule: 'unknown_category' };
}

/** What the separate triage call said about one style note. */
export const STYLE_TRIAGE = ['style_only', 'may_change_facts', 'unsure'] as const;

export interface ClassifiedStyleNote {
  text: string;
  /** Does not block automatic publication. */
  safe: boolean;
  triage: string | null;
  markers: string[];
  rule: 'style_confirmed' | 'style_unconfirmed' | 'style_fact_marker';
}

/** A style note is safe only if the triage AND the marker check both clear it. */
export function classifyStyleNote(n: {
  text: string;
  triage?: string | null;
}): ClassifiedStyleNote {
  const markers = factMarkers(n.text);
  const triage = n.triage ?? null;
  const rule =
    triage !== 'style_only'
      ? 'style_unconfirmed'
      : markers.length > 0
        ? 'style_fact_marker'
        : 'style_confirmed';
  return { text: n.text.slice(0, 300), safe: rule === 'style_confirmed', triage, markers, rule };
}
