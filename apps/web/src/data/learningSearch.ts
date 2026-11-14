import type { Route } from '../lib/navigation.js';
import {
  libraryItems,
  loadLibraryText,
  subjectLabel,
  type LibraryItem,
} from './library/library.js';
import { examNumbersLabel, loadMathTheory, mathTheoryCatalog } from './theory/mathTheory.js';
import { loadTheoryMaterial, russianTheory, theoryGroups } from './theory/russianTheory.js';

/**
 * One search over the whole learning centre (docs/LIBRARY.md): the Russian
 * and math theory, «Полезные материалы» and «Стратегии». The index is built
 * from the existing manifests — nothing is stored twice. Titles, topics,
 * descriptions and subjects are searched at once; the texts themselves are
 * fetched lazily (one chunk each) the first time a query of 3+ letters asks
 * for them, then kept in memory.
 */

export type SearchKind = 'theory' | 'material' | 'strategy';

export const searchKindLabels: Record<SearchKind, string> = {
  theory: 'Теория',
  material: 'Полезные материалы',
  strategy: 'Стратегии',
};

export interface SearchEntry {
  key: string;
  kind: SearchKind;
  subject: 'math' | 'russian' | 'general';
  title: string;
  topic: string;
  description: string;
  /** EGE task numbers the entry belongs to. */
  tasks: readonly number[];
  route: Route;
  loadText: () => Promise<string>;
}

export interface SearchResult {
  entry: SearchEntry;
  /** A piece of the text around the first match, when the match is in the text. */
  snippet: string | null;
  score: number;
}

function libraryEntry(item: LibraryItem): SearchEntry {
  return {
    key: `library:${item.id}`,
    kind: item.section === 'strategies' ? 'strategy' : 'material',
    subject: item.subject,
    title: item.title,
    topic: item.topic,
    description: item.description,
    tasks: item.tasks ?? [],
    route: { screen: 'library', section: item.section, itemId: item.id },
    loadText: () => loadLibraryText(item),
  };
}

/** Numbers of the current editions only — not the old Ященко-2027 numbering. */
function currentNumbers(label: string): number[] {
  return label
    .split(' · ')
    .filter((part) => !part.startsWith('Ященко'))
    .flatMap((part) => [...part.matchAll(/№(\d+)/g)].map((m) => Number(m[1])));
}

let cachedEntries: SearchEntry[] | null = null;

/** Every searchable page of the learning centre. */
export function searchEntries(): SearchEntry[] {
  if (cachedEntries) return cachedEntries;
  const russian: SearchEntry[] = russianTheory
    .filter((t) => t.materials.length > 0)
    .map((t) => ({
      key: `ru:${t.taskNumber}`,
      kind: 'theory' as const,
      subject: 'russian' as const,
      title: `№${t.taskNumber}. ${t.title}`,
      topic: theoryGroups.find((g) => g.id === t.group)?.title ?? '',
      description: `Конспект, практика и справочные материалы к заданию ${t.taskNumber}`,
      tasks: [t.taskNumber],
      route: { screen: 'theory' as const, section: 'rules' as const, taskNumber: t.taskNumber },
      loadText: async () =>
        (await Promise.all(t.materials.map((m) => loadTheoryMaterial(m.id)))).join('\n\n'),
    }));
  const math: SearchEntry[] = mathTheoryCatalog().flatMap(({ topic, material }) =>
    material
      ? [
          {
            key: `math:${topic.key}`,
            kind: 'theory' as const,
            subject: 'math' as const,
            title: topic.title,
            topic: 'Профильная математика',
            description: examNumbersLabel(topic.key),
            tasks: currentNumbers(examNumbersLabel(topic.key)),
            route: {
              screen: 'theory' as const,
              section: 'rules' as const,
              subject: 'math' as const,
              topic: topic.key,
            },
            loadText: () => loadMathTheory(material.file),
          },
        ]
      : [],
  );
  cachedEntries = [...libraryItems.map(libraryEntry), ...russian, ...math];
  return cachedEntries;
}

/** Lower case, «ё» as «е», collapsed spaces — same length as the input. */
export function normalize(s: string): string {
  return s.toLowerCase().replaceAll('ё', 'е');
}

const endings = [
  'ями',
  'ами',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'иях',
  'иям',
  'ией',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ый',
  'ий',
  'ой',
  'ов',
  'ев',
  'ам',
  'ям',
  'ах',
  'ях',
  'ом',
  'ем',
  'ую',
  'юю',
  'ия',
  'ию',
  'а',
  'я',
  'о',
  'е',
  'ы',
  'и',
  'у',
  'ю',
  'ь',
  'й',
];

/**
 * A crude Russian stem: a word of 5+ letters loses its case ending, so
 * «производная» also finds «производных», «дроби» — «дробь». It never cuts
 * below four letters; short words and numbers stay as typed.
 */
export function stem(token: string): string {
  if (token.length < 5 || !/^[а-я]+$/.test(token)) return token;
  for (const ending of endings) {
    if (token.endsWith(ending) && token.length - ending.length >= 4) {
      return token.slice(0, -ending.length);
    }
  }
  return token;
}

/** Query words (2+ characters, or a task number), stemmed. */
export function queryTokens(query: string): string[] {
  return normalize(query)
    .replace(/№/g, ' ')
    .split(/[\s,.;:!?«»"()]+/)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t))
    .map(stem);
}

/** Markdown and TeX markup that should not show in a snippet. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^#\s.*$/m, '') // the H1 repeats the title shown above the snippet
    .replace(/^>\s?\[![a-z]+\]\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[#*`|_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetAround(text: string, token: string): string | null {
  const at = normalize(text).indexOf(token);
  if (at < 0) return null;
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 60)) + 1);
  const end = Math.min(text.length, at + token.length + 90);
  const cut = text.indexOf(' ', end);
  const stop = cut < 0 || cut - end > 20 ? end : cut;
  return `${start > 0 ? '…' : ''}${text.slice(start, stop).trim()}${stop < text.length ? '…' : ''}`;
}

const textCache = new Map<string, string>();

/** Texts already loaded (plain text, for matching and snippets). */
export function cachedText(key: string): string | undefined {
  return textCache.get(key);
}

/** Loads (once) the texts of all entries; resolves when every text is in. */
let loadingAll: Promise<void> | null = null;
export function loadAllTexts(): Promise<void> {
  loadingAll ??= Promise.all(
    searchEntries().map(async (e) => {
      if (!textCache.has(e.key)) textCache.set(e.key, plainText(await e.loadText()));
    }),
  ).then(
    () => undefined,
    (error: unknown) => {
      loadingAll = null;
      throw error;
    },
  );
  return loadingAll;
}

export interface SearchOptions {
  subject?: 'math' | 'russian' | 'general' | 'all';
  kinds?: readonly SearchKind[];
}

/**
 * Every query word must occur somewhere — in the title, topic, description,
 * subject name, a task number or the text. Title hits rank first, then
 * metadata, then the text; ties keep the manifest order.
 */
export function searchLearning(query: string, options: SearchOptions = {}): SearchResult[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const results: SearchResult[] = [];
  for (const entry of searchEntries()) {
    if (options.subject && options.subject !== 'all' && entry.subject !== options.subject) continue;
    if (options.kinds && !options.kinds.includes(entry.kind)) continue;
    const title = normalize(entry.title);
    const meta = normalize(
      `${entry.topic} ${entry.description} ${subjectLabel(entry.subject)} ${searchKindLabels[entry.kind]}`,
    );
    const text = cachedText(entry.key);
    const normText = text ? normalize(text) : '';
    let score = 0;
    let snippet: string | null = null;
    let all = true;
    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        if (entry.tasks.includes(Number(token))) score += 8;
        // A longer number (a year) may match text; a task number only matches tasks,
        // so «16» never finds a topic through the old Ященко-2027 numbering.
        else if (token.length >= 3 && (title.includes(token) || meta.includes(token))) score += 3;
        else {
          all = false;
          break;
        }
        continue;
      }
      if (title.includes(token)) score += 10;
      else if (meta.includes(token)) score += 5;
      else if (normText.includes(token)) {
        score += 1;
        snippet ??= snippetAround(text!, token);
      } else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    // A text snippet helps even when the title matched: show where the word is.
    if (!snippet && text) {
      for (const token of tokens) {
        if (!/^\d+$/.test(token) && !title.includes(token)) {
          snippet = snippetAround(text, token);
          if (snippet) break;
        }
      }
    }
    results.push({ entry, snippet, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Splits text into plain and matched parts for highlighting: every
 * occurrence of a query word, case- and «ё»-insensitive.
 */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const tokens = queryTokens(query).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [{ text, hit: false }];
  const norm = normalize(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let at = norm.indexOf(token);
    while (at >= 0) {
      // The query word is a stem: mark the rest of the word too.
      let end = at + token.length;
      while (end < norm.length && /[а-яa-z]/.test(norm[end]!)) end++;
      for (let i = at; i < end; i++) marks[i] = true;
      at = norm.indexOf(token, end);
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i]!, hit: marks[i]! });
  }
  return parts;
}
