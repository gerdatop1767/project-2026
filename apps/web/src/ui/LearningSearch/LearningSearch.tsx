import { useDeferredValue, useEffect, useState } from 'react';
import {
  highlightParts,
  loadAllTexts,
  queryTokens,
  searchKindLabels,
  searchLearning,
  type SearchOptions,
  type SearchResult,
} from '../../data/learningSearch.js';
import { subjectLabel } from '../../data/library/library.js';
import { useNavigation } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import styles from './LearningSearch.module.css';

/** Text with every query word wrapped in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

/** Whether the full texts are needed: a word of 3+ letters (not just a number). */
function wantsTexts(query: string): boolean {
  return queryTokens(query).some((t) => t.length >= 3 && !/^\d+$/.test(t));
}

/**
 * The search box. Controlled by its parent, which decides what to show
 * while a query is typed (usually `LearningSearchResults` instead of the
 * regular content).
 */
export function LearningSearchBox({
  value,
  onChange,
  placeholder = 'Поиск по теории, материалам и стратегиям',
  label = 'Поиск по учебному центру',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={clsx(styles.box, className)}>
      <Icon name="search" size={18} className={styles.boxIcon} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={styles.input}
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label="Очистить поиск"
          onClick={() => onChange('')}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * Results for a query over the whole learning centre (or a part of it):
 * kind and subject of each page, the title and a text snippet with the
 * matches highlighted. Texts load on the first query that needs them;
 * until then title/topic matches are shown and a note says texts are
 * being searched.
 */
export function LearningSearchResults({
  query,
  options,
  onOpen,
}: {
  query: string;
  options?: SearchOptions;
  /** Called after a result is opened (e.g. to clear the query). */
  onOpen?: () => void;
}) {
  const { navigate } = useNavigation();
  const deferred = useDeferredValue(query);
  const [textsReady, setTextsReady] = useState(false);
  const [textsFailed, setTextsFailed] = useState(false);
  const needTexts = wantsTexts(deferred);

  useEffect(() => {
    if (!needTexts || textsReady) return;
    let live = true;
    loadAllTexts().then(
      () => live && setTextsReady(true),
      () => live && setTextsFailed(true),
    );
    return () => {
      live = false;
    };
  }, [needTexts, textsReady]);

  if (queryTokens(deferred).length === 0) {
    return (
      <p className={styles.note} role="status">
        Введи хотя бы две буквы или номер задания.
      </p>
    );
  }

  // Recomputed on every render: once the texts arrive (`textsReady`
  // changes) the same query also finds matches inside them.
  const results: SearchResult[] = searchLearning(deferred, options);
  const searchingTexts = needTexts && !textsReady && !textsFailed;

  return (
    <section className={styles.results} aria-label="Результаты поиска">
      <p className={styles.count} role="status" aria-live="polite">
        {results.length > 0
          ? `Найдено: ${results.length}`
          : searchingTexts
            ? 'Ищем в текстах…'
            : 'Ничего не найдено'}
        {results.length > 0 && searchingTexts ? ' · ищем в текстах…' : ''}
      </p>
      {results.length === 0 && !searchingTexts && (
        <div className={styles.empty}>
          <Icon name="emptyState" size={28} />
          <p className="text-body" style={{ fontWeight: 700 }}>
            По запросу «{query.trim()}» ничего не найдено
          </p>
          <p className="text-body-sm text-secondary">
            Проверь написание, попробуй синоним или номер задания: «производная», «запятые», «15».
            {textsFailed && ' Тексты материалов не загрузились — искали только по названиям.'}
          </p>
        </div>
      )}
      <ul className={styles.list}>
        {results.map(({ entry, snippet }) => (
          <li key={entry.key}>
            <button
              type="button"
              className={styles.result}
              onClick={() => {
                navigate(entry.route);
                onOpen?.();
              }}
            >
              <span className={styles.meta}>
                <span className={clsx(styles.kind, styles[entry.kind])}>
                  {searchKindLabels[entry.kind]}
                </span>
                <span className={styles.subject}>{subjectLabel(entry.subject)}</span>
                {entry.topic && <span className={styles.topic}>{entry.topic}</span>}
              </span>
              <span className={styles.title}>
                <Highlight text={entry.title} query={deferred} />
              </span>
              <span className={styles.snippet}>
                <Highlight text={snippet ?? entry.description} query={deferred} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
