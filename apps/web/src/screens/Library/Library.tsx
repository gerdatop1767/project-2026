import { useEffect, useRef, useState } from 'react';
import {
  libraryItem,
  libraryItems,
  librarySubjects,
  loadLibraryText,
  subjectLabel,
  type LibraryItem,
} from '../../data/library/library.js';
import { useNavigation, type LibrarySection, type LibrarySubject } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SkeletonParagraph } from '../../ui/Skeleton/Skeleton.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { TheoryMarkdown } from '../../ui/Theory/TheoryMarkdown.js';
import {
  LearningSearchBox,
  LearningSearchResults,
} from '../../ui/LearningSearch/LearningSearch.js';
import styles from './Library.module.css';

const sectionTabs = [
  { id: 'materials', label: 'Полезные материалы' },
  { id: 'strategies', label: 'Стратегии' },
] as const;

const sectionInfo: Record<LibrarySection, { title: string; lead: string }> = {
  materials: {
    title: 'Полезные материалы',
    lead: 'Таблицы формул, справочники, схемы и шпаргалки по профильной математике и русскому языку.',
  },
  strategies: {
    title: 'Стратегии',
    lead: 'Как готовиться и как работать на экзамене: время, порядок заданий, оформление, проверка. Без обещаний «гарантированных баллов» — только приёмы, которые проверяются на практике.',
  },
};

type LoadState = { status: 'loading' } | { status: 'ready'; source: string } | { status: 'error' };
const cache = new Map<string, string>();

function useLibraryText(item: LibraryItem): [LoadState, () => void] {
  const [state, setState] = useState<LoadState>(() => {
    const cached = cache.get(item.id);
    return cached !== undefined ? { status: 'ready', source: cached } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cache.has(item.id)) return;
    let live = true;
    loadLibraryText(item).then(
      (source) => {
        cache.set(item.id, source);
        if (live) setState({ status: 'ready', source });
      },
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [item, attempt]);
  return [
    state,
    () => {
      setState({ status: 'loading' });
      setAttempt((n) => n + 1);
    },
  ];
}

function TaskChips({ item }: { item: LibraryItem }) {
  if (!item.tasks?.length) return null;
  return (
    <span className={styles.tasks} aria-label={`Задания ${item.tasks.join(', ')}`}>
      {item.tasks.map((n) => (
        <span key={n} className={styles.task}>
          №{n}
        </span>
      ))}
    </span>
  );
}

function ItemCard({ item, onOpen }: { item: LibraryItem; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={clsx(styles.card, styles[item.subject])} onClick={onOpen}>
        <span className={styles.cardTopic}>{item.topic}</span>
        <span className={styles.cardTitle}>{item.title}</span>
        <span className={styles.cardText}>{item.description}</span>
        <span className={styles.cardFoot}>
          <TaskChips item={item} />
          <Icon name="arrowRight" size={16} className={styles.cardArrow} />
        </span>
      </button>
    </li>
  );
}

function ItemPage({ item, onBack }: { item: LibraryItem; onBack: () => void }) {
  const { navigate } = useNavigation();
  const [state, retry] = useLibraryText(item);
  const theorySubject = item.subject === 'math' ? 'math' : 'russian';
  return (
    <article className={styles.article} aria-labelledby="library-item-title">
      <button type="button" className={styles.back} onClick={onBack}>
        <Icon name="back" size={18} />{' '}
        {item.section === 'strategies' ? 'Все стратегии' : 'Все материалы'}
      </button>
      <p className={styles.kicker}>
        {subjectLabel(item.subject)} · {item.topic}
      </p>
      <h2 id="library-item-title" className="text-h2">
        {item.title}
      </h2>
      <p className={styles.lead}>{item.description}</p>
      {item.tasks && item.tasks.length > 0 && item.subject !== 'general' && (
        <p className={styles.related}>
          <span>Теория к заданиям:</span>
          {item.tasks.map((n) => (
            <button
              key={n}
              type="button"
              className={styles.relatedLink}
              onClick={() =>
                navigate(
                  theorySubject === 'math'
                    ? { screen: 'theory', section: 'rules', subject: 'math', taskNumber: n }
                    : { screen: 'theory', section: 'rules', taskNumber: n },
                )
              }
            >
              №{n}
            </button>
          ))}
        </p>
      )}
      <div className={styles.body}>
        {state.status === 'loading' && (
          <div aria-busy="true" aria-label="Материал загружается">
            <SkeletonParagraph lines={8} />
          </div>
        )}
        {state.status === 'error' && (
          <div className={styles.error} role="alert">
            <p>Не удалось загрузить материал.</p>
            <Button variant="secondary" onClick={retry}>
              Повторить
            </Button>
          </div>
        )}
        {state.status === 'ready' && (
          <TheoryMarkdown source={state.source} stress={item.theoryFile === 'task-04-reference'} />
        )}
      </div>
    </article>
  );
}

export interface LibraryProps {
  section: LibrarySection;
  itemId?: string;
  subject?: LibrarySubject;
}

/**
 * «Полезные материалы» и «Стратегии» (docs/LIBRARY.md): a filterable card
 * library and a reading page per item. The section, the subject filter and
 * the open item live in the URL; the search box searches this section
 * (with the filter) — the learning centre's search covers everything.
 */
export function Library({ section, itemId, subject }: LibraryProps) {
  const { navigate } = useNavigation();
  const [query, setQuery] = useState('');
  const openedFromList = useRef(false);
  const item = itemId ? libraryItem(itemId) : null;
  const shownItem = item && item.section === section ? item : null;

  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [itemId, section]);

  const inSection = libraryItems.filter((x) => x.section === section);
  const subjectsHere = librarySubjects.filter((s) => inSection.some((x) => x.subject === s.id));
  const filterTabs = [{ id: 'all', label: 'Все' }, ...subjectsHere];
  const visible = inSection.filter((x) => !subject || x.subject === subject);
  const groups = subjectsHere
    .filter((s) => !subject || s.id === subject)
    .map((s) => ({ ...s, items: visible.filter((x) => x.subject === s.id) }))
    .filter((g) => g.items.length > 0);

  function open(next: LibraryItem) {
    openedFromList.current = true;
    navigate({ screen: 'library', section, ...(subject ? { subject } : {}), itemId: next.id });
  }

  function back() {
    if (openedFromList.current) {
      openedFromList.current = false;
      window.history.back();
    } else {
      navigate({ screen: 'library', section, ...(subject ? { subject } : {}) }, { replace: true });
    }
  }

  if (shownItem) {
    return (
      <div className={styles.screen}>
        <ItemPage key={shownItem.id} item={shownItem} onBack={back} />
      </div>
    );
  }

  const info = sectionInfo[section];
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1 className="text-h1">{info.title}</h1>
          <p className="text-body-sm text-secondary">{info.lead}</p>
        </div>
        <Tabs
          aria-label="Раздел"
          items={sectionTabs}
          activeId={section}
          onChange={(id) =>
            navigate({ screen: 'library', section: id as LibrarySection }, { replace: true })
          }
          className={styles.sectionTabs}
        />
      </header>

      <div className={styles.toolbar}>
        <LearningSearchBox
          value={query}
          onChange={setQuery}
          placeholder={section === 'strategies' ? 'Поиск по стратегиям' : 'Поиск по материалам'}
          label={section === 'strategies' ? 'Поиск по стратегиям' : 'Поиск по материалам'}
        />
        {subjectsHere.length > 1 && (
          <Tabs
            aria-label="Предмет"
            items={filterTabs}
            activeId={subject ?? 'all'}
            onChange={(id) =>
              navigate(
                {
                  screen: 'library',
                  section,
                  ...(id === 'all' ? {} : { subject: id as LibrarySubject }),
                },
                { replace: true },
              )
            }
            scrollable
          />
        )}
      </div>

      {query.trim() ? (
        <LearningSearchResults
          query={query}
          options={{
            subject: subject ?? 'all',
            kinds: [section === 'strategies' ? 'strategy' : 'material'],
          }}
        />
      ) : (
        groups.map((g) => (
          <section key={g.id} className={styles.group} aria-labelledby={`lib-${g.id}`}>
            <h2 id={`lib-${g.id}`} className={styles.groupTitle}>
              {g.label} <span className={styles.groupCount}>{g.items.length}</span>
            </h2>
            <ul className={styles.grid}>
              {g.items.map((x) => (
                <ItemCard key={x.id} item={x} onOpen={() => open(x)} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
