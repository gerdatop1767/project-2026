import type { IconName } from '../ui/Icon/icons.js';

/**
 * Presentation-only grouping of the REAL topics in the database into a
 * few sections, so the training screen can show compact categories
 * instead of one long flat list. The topics themselves (ids, names,
 * counts) always come from the API; this only decides which section a
 * topic slug is listed under. A slug no rule matches (a new topic added
 * later) lands in «Другие темы» — never hidden, never renamed.
 */
export interface TopicGroupDef {
  id: string;
  title: string;
  icon: IconName;
  match: RegExp;
}

const mathGroups: readonly TopicGroupDef[] = [
  {
    id: 'equations',
    title: 'Уравнения и неравенства',
    icon: 'topicEquations',
    match: /(equations|^inequalities|^parameters)/,
  },
  {
    id: 'functions',
    title: 'Функции и производная',
    icon: 'topicFunctions',
    match: /^(functions?-|derivative)/,
  },
  {
    id: 'geometry',
    title: 'Геометрия',
    icon: 'topicPlanimetry',
    match: /^(planimetry|stereometry|vectors|geometry-)/,
  },
  {
    id: 'word-problems',
    title: 'Текстовые и прикладные задачи',
    icon: 'checklist',
    match: /(word-problems|^economics|^physics|^practical|^data-reading)/,
  },
  {
    id: 'probability',
    title: 'Вероятность и статистика',
    icon: 'topicProbability',
    match: /^probability/,
  },
  {
    id: 'numbers',
    title: 'Числа и выражения',
    icon: 'percent',
    match: /^(numbers|number-theory|logarithms$|trig(onometry)?-identities)/,
  },
];

const russianGroups: readonly TopicGroupDef[] = [
  {
    id: 'lexis',
    title: 'Орфоэпия и лексика',
    icon: 'language',
    match: /^russian-(orthoepy|paronyms|lexical|phraseology|antonyms|synonyms|terminology)/,
  },
  {
    id: 'grammar',
    title: 'Грамматика и морфология',
    icon: 'checklist',
    match: /^russian-(grammar|grammatical|conjunctions|particles?|prepositions|pronouns?)/,
  },
  {
    id: 'spelling',
    title: 'Орфография',
    icon: 'edit',
    match: /^russian-(.*spelling.*|not-with-words)$/,
  },
  {
    id: 'punctuation',
    title: 'Пунктуация',
    icon: 'notes',
    match: /^russian-(punctuation|comma|colon|dash)/,
  },
  {
    id: 'text',
    title: 'Работа с текстом',
    icon: 'reference',
    match: /^russian-(text|sentence-connections|cohesion|functional-text|literary-devices)/,
  },
  { id: 'essay', title: 'Сочинение', icon: 'brush', match: /^russian-essay/ },
];

const groupsBySubject: Record<string, readonly TopicGroupDef[]> = {
  math: mathGroups,
  russian: russianGroups,
};

export const OTHER_GROUP: TopicGroupDef = {
  id: 'other',
  title: 'Другие темы',
  icon: 'grid',
  match: /$^/,
};

export interface GroupedTopics<T> {
  group: TopicGroupDef;
  topics: T[];
}

/**
 * Splits `topics` into the subject's sections (in their fixed order),
 * keeping the API's topic order inside a section and dropping empty
 * sections. Topics without a known slug go to «Другие темы».
 */
export function groupTopics<T extends { topicSlug?: string | null }>(
  subjectId: string,
  topics: readonly T[],
): GroupedTopics<T>[] {
  const defs = groupsBySubject[subjectId] ?? [];
  const buckets = new Map<string, T[]>();
  for (const topic of topics) {
    const slug = topic.topicSlug ?? '';
    const def = defs.find((d) => slug && d.match.test(slug)) ?? OTHER_GROUP;
    const list = buckets.get(def.id) ?? [];
    list.push(topic);
    buckets.set(def.id, list);
  }
  return [...defs, OTHER_GROUP]
    .filter((def) => buckets.has(def.id))
    .map((def) => ({ group: def, topics: buckets.get(def.id)! }));
}
