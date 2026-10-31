import { useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  loadTheoryMaterial,
  russianTheory,
  theoryGroups,
  theorySources,
  type TheoryMaterialKind,
  type TheoryTask,
} from '../../data/theory/russianTheory.js';
import { useNavigation, type TheorySection } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { TheoryTaskView } from '../../ui/Theory/TheoryTaskView.js';
import styles from './TheoryCatalog.module.css';

const sectionKinds: Record<TheorySection, readonly TheoryMaterialKind[]> = {
  rules: ['theory'],
  materials: ['reference', 'practice'],
};

const sectionTabs = [
  { id: 'rules', label: 'Теория' },
  { id: 'materials', label: 'Полезные материалы' },
] as const;

const sectionLead: Record<TheorySection, string> = {
  rules: 'Конспекты правил по номерам заданий ЕГЭ по русскому языку.',
  materials: 'Справочные списки (ударения, паронимы) и практика с ответами к каждому заданию.',
};

/** Full text of every material, loaded only once someone searches by words. */
let fullText: Promise<Map<string, string>> | null = null;
function loadFullText(): Promise<Map<string, string>> {
  fullText ??= Promise.all(
    russianTheory.flatMap((t) =>
      t.materials.map(async (m) => [m.id, (await loadTheoryMaterial(m.id)).toLowerCase()] as const),
    ),
  ).then(
    (entries) => new Map(entries),
    (error: unknown) => {
      fullText = null;
      throw error;
    },
  );
  return fullText;
}

function useSearch(
  query: string,
  section: TheorySection,
): {
  matches: (task: TheoryTask) => boolean;
  searchingText: boolean;
} {
  const q = query.trim().toLowerCase().replace(/^№\s*/, '');
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const wantsText = q.length >= 3 && !/^\d+$/.test(q);
  useEffect(() => {
    if (!wantsText || texts) return;
    let live = true;
    loadFullText().then(
      (map) => live && setTexts(map),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsText, texts]);

  const kinds = sectionKinds[section];
  return {
    searchingText: wantsText && !texts,
    matches: (task) => {
      if (!q) return true;
      if (/^\d+$/.test(q)) return String(task.taskNumber) === q;
      if (task.title.toLowerCase().includes(q)) return true;
      return task.materials.some(
        (m) => kinds.includes(m.kind) && (texts?.get(m.id)?.includes(q) ?? false),
      );
    },
  };
}

function materialsLabel(n: number): string {
  if (n === 0) return 'пока нет материала';
  if (n === 1) return '1 материал';
  return n < 5 ? `${n} материала` : `${n} материалов`;
}

export interface TheoryCatalogProps {
  section: TheorySection;
  taskNumber?: number;
}

/**
 * «Теория» / «Полезные материалы» for Russian (docs/THEORY.md): tasks
 * grouped by part of the exam, a search over numbers, titles and the
 * texts themselves, and a reading pane. Wide screens show the list and
 * the text side by side; on a phone the list opens a task and Back
 * returns to the list with the search still in place. The section and
 * the chosen number live in the URL, so a refresh keeps them.
 */
export function TheoryCatalog({ section, taskNumber }: TheoryCatalogProps) {
  const { navigate } = useNavigation();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const search = useSearch(deferredQuery, section);
  const kinds = sectionKinds[section];
  const pushedFromList = useRef(false);
  const readerRef = useRef<HTMLDivElement>(null);

  const selected = russianTheory.find((t) => t.taskNumber === taskNumber) ?? null;
  const groups = theoryGroups
    .map((group) => ({
      ...group,
      tasks: russianTheory.filter((t) => t.group === group.id && search.matches(t)),
    }))
    .filter((g) => g.tasks.length > 0);

  // A newly opened task starts at its top, not where the previous one was read.
  useEffect(() => {
    readerRef.current?.scrollTo?.({ top: 0 });
  }, [taskNumber, section]);

  function open(task: TheoryTask) {
    pushedFromList.current = true;
    navigate({ screen: 'theory', section, taskNumber: task.taskNumber });
  }

  function backToList() {
    if (pushedFromList.current) {
      pushedFromList.current = false;
      window.history.back();
    } else {
      navigate({ screen: 'theory', section }, { replace: true });
    }
  }

  const count = (task: TheoryTask) => task.materials.filter((m) => kinds.includes(m.kind)).length;

  return (
    <div className={clsx(styles.screen, selected && styles.hasSelection)}>
      <header className={styles.head}>
        <div>
          <h1 className="text-h1">{section === 'rules' ? 'Теория' : 'Полезные материалы'}</h1>
          <p className="text-body-sm text-secondary">Русский язык · {sectionLead[section]}</p>
        </div>
        <Tabs
          aria-label="Раздел"
          items={sectionTabs}
          activeId={section}
          onChange={(id) =>
            navigate(
              { screen: 'theory', section: id as TheorySection, taskNumber },
              { replace: true },
            )
          }
          className={styles.sectionTabs}
        />
      </header>

      <div className={styles.layout}>
        <nav className={styles.list} aria-label="Задания">
          <label className={styles.search}>
            <Icon name="search" size={18} className={styles.searchIcon} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Номер, тема или слово"
              aria-label="Поиск по правилам"
              className={styles.searchInput}
            />
          </label>
          {search.searchingText && (
            <p className={styles.searchNote} aria-live="polite">
              Ищем в текстах…
            </p>
          )}
          {groups.length === 0 && !search.searchingText && (
            <p className={styles.searchNote} aria-live="polite">
              Ничего не нашлось. Попробуй номер задания или другое слово.
            </p>
          )}
          {groups.map((group) => (
            <section key={group.id} className={styles.group}>
              <h2 className={styles.groupTitle}>{group.title}</h2>
              <ul className={styles.items}>
                {group.tasks.map((task) => {
                  const n = count(task);
                  return (
                    <li key={task.taskNumber}>
                      <button
                        type="button"
                        className={clsx(
                          styles.item,
                          task.taskNumber === taskNumber && styles.itemActive,
                          n === 0 && styles.itemEmpty,
                        )}
                        aria-current={task.taskNumber === taskNumber ? 'true' : undefined}
                        aria-label={`№${task.taskNumber}. ${task.title} — ${materialsLabel(n)}`}
                        onClick={() => open(task)}
                      >
                        <span className={styles.number}>{task.taskNumber}</span>
                        <span className={styles.itemText}>
                          <span className={styles.itemTitle}>{task.title}</span>
                          <span className={styles.itemMeta}>{materialsLabel(n)}</span>
                        </span>
                        <Icon name="chevronRight" size={16} className={styles.chevron} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className={styles.reader} ref={readerRef}>
          {selected ? (
            <article className={styles.article} aria-labelledby="theory-task-title">
              <button type="button" className={styles.backToList} onClick={backToList}>
                <Icon name="back" size={18} /> Все задания
              </button>
              <p className={styles.kicker}>Задание №{selected.taskNumber}</p>
              <h2 id="theory-task-title" className="text-h2">
                {selected.title}
              </h2>
              <TheoryTaskView
                key={`${section}-${selected.taskNumber}`}
                task={selected}
                kinds={kinds}
              />
            </article>
          ) : (
            <div className={styles.placeholder}>
              <Icon name="reference" size={28} />
              <p className="text-body" style={{ fontWeight: 700 }}>
                Выбери номер задания
              </p>
              <p className="text-body-sm text-secondary">
                Материалы привязаны к номерам ЕГЭ — те же номера, что в тренировке.
              </p>
              <ul className={styles.sources}>
                {theorySources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
