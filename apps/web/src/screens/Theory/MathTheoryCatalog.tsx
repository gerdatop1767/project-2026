import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { EXAM_TASK_SPECS, EXAM_TOPICS, type ExamTaskSpec } from '@zybrilka/shared';
import {
  loadMathTheory,
  mathMaterialFor,
  type MathTheoryMaterial,
} from '../../data/theory/mathTheory.js';
import { useNavigation, type TheorySection } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { MathTopicTheory } from '../../ui/Theory/MathTopicTheory.js';
import { TheorySubjectTabs } from './TheorySubjectTabs.js';
import styles from './TheoryCatalog.module.css';
import mathStyles from './MathTheoryCatalog.module.css';

export const MATH_THEORY_YEARS = [2027, 2026] as const;
export const DEFAULT_MATH_YEAR = 2027;

const sectionTabs = [
  { id: 'rules', label: 'Теория' },
  { id: 'materials', label: 'Полезные материалы' },
] as const;

const yearTabs = [
  { id: '2027', label: 'ЕГЭ-2027' },
  { id: '2026', label: 'ЕГЭ-2026' },
] as const;

const topicTitle = (key: string) => EXAM_TOPICS.find((t) => t.key === key)?.title ?? key;

function materialsOf(spec: ExamTaskSpec): MathTheoryMaterial[] {
  return spec.topics
    .filter((b) => b.status !== 'unclear')
    .map((b) => mathMaterialFor(b.topicKey))
    .filter((m): m is MathTheoryMaterial => m !== null);
}

/** Full texts, loaded only once someone searches by words. */
let fullText: Promise<Map<string, string>> | null = null;
function loadAllTexts(files: readonly string[]): Promise<Map<string, string>> {
  fullText ??= Promise.all(
    files.map(async (f) => [f, (await loadMathTheory(f)).toLowerCase()] as const),
  ).then(
    (entries) => new Map(entries),
    (error: unknown) => {
      fullText = null;
      throw error;
    },
  );
  return fullText;
}

export interface MathTheoryCatalogProps {
  section: TheorySection;
  year?: number;
  taskNumber?: number;
}

/**
 * Profile-math theory by exam number, in the numbering of the chosen year
 * (docs/theory/EXAM-NUMBERING.md). Each number opens the theory of its
 * topic(s); the same topic is reached from both years without copies.
 */
export function MathTheoryCatalog({ section, year: yearProp, taskNumber }: MathTheoryCatalogProps) {
  const { navigate } = useNavigation();
  const year = yearProp ?? DEFAULT_MATH_YEAR;
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query).trim().toLowerCase().replace(/^№\s*/, '');
  const readerRef = useRef<HTMLDivElement>(null);
  const pushedFromList = useRef(false);

  const specs = EXAM_TASK_SPECS.filter((s) => s.subjectId === 'math' && s.year === year);
  const selected = specs.find((s) => s.number === taskNumber) ?? null;

  const wantsText = q.length >= 3 && !/^\d+$/.test(q);
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!wantsText || texts) return;
    let live = true;
    const files = [...new Set(specs.flatMap((s) => materialsOf(s).map((m) => m.file)))];
    loadAllTexts(files).then(
      (map) => live && setTexts(map),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsText, texts, specs]);

  const matches = (spec: ExamTaskSpec) => {
    if (!q) return true;
    if (/^\d+$/.test(q)) return String(spec.number) === q;
    if (spec.title.toLowerCase().includes(q)) return true;
    if (spec.topics.some((b) => topicTitle(b.topicKey).toLowerCase().includes(q))) return true;
    return materialsOf(spec).some((m) => texts?.get(m.file)?.includes(q) ?? false);
  };

  const groups = [
    { id: 1, title: 'Часть 1 — краткий ответ' },
    { id: 2, title: 'Часть 2 — развёрнутое решение' },
  ]
    .map((g) => ({ ...g, specs: specs.filter((s) => s.part === g.id && matches(s)) }))
    .filter((g) => g.specs.length > 0);

  useEffect(() => {
    readerRef.current?.scrollTo?.({ top: 0 });
  }, [taskNumber, year]);

  function go(next: { year?: number; taskNumber?: number }, replace = false) {
    navigate(
      {
        screen: 'theory',
        section,
        subject: 'math',
        year: next.year ?? year,
        ...(next.taskNumber ? { taskNumber: next.taskNumber } : {}),
      },
      replace ? { replace: true } : undefined,
    );
  }

  function open(spec: ExamTaskSpec) {
    pushedFromList.current = true;
    go({ taskNumber: spec.number });
  }

  function backToList() {
    if (pushedFromList.current) {
      pushedFromList.current = false;
      window.history.back();
    } else {
      go({}, true);
    }
  }

  return (
    <div className={clsx(styles.screen, selected && styles.hasSelection)}>
      <header className={styles.head}>
        <div>
          <h1 className="text-h1">{section === 'rules' ? 'Теория' : 'Полезные материалы'}</h1>
          <p className="text-body-sm text-secondary">
            Профильная математика · теория по номерам заданий, общая для ЕГЭ-2026 и ЕГЭ-2027
          </p>
        </div>
        <div className={styles.switches}>
          <TheorySubjectTabs section={section} subject="math" />
          <Tabs
            aria-label="Раздел"
            items={sectionTabs}
            activeId={section}
            onChange={(id) =>
              navigate(
                {
                  screen: 'theory',
                  section: id as TheorySection,
                  subject: 'math',
                  year,
                  ...(taskNumber ? { taskNumber } : {}),
                },
                { replace: true },
              )
            }
          />
          <Tabs
            aria-label="Нумерация какого года"
            items={yearTabs}
            activeId={String(year)}
            onChange={(id) => go({ year: Number(id) }, true)}
          />
        </div>
      </header>

      {section === 'materials' ? (
        <div className={mathStyles.notice}>
          <Icon name="reference" size={24} />
          <div>
            <p className="text-body" style={{ fontWeight: 700 }}>
              Справочники по математике готовятся
            </p>
            <p className="text-body-sm text-secondary">
              Таблицы формул и шпаргалки появятся здесь отдельными страницами. Пока вся теория — в
              разделе «Теория».
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.layout}>
          <nav className={styles.list} aria-label="Задания">
            <label className={styles.search}>
              <Icon name="search" size={18} className={styles.searchIcon} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Номер, тема или слово"
                aria-label="Поиск по теории"
                className={styles.searchInput}
              />
            </label>
            {wantsText && !texts && (
              <p className={styles.searchNote} aria-live="polite">
                Ищем в текстах…
              </p>
            )}
            {groups.length === 0 && !(wantsText && !texts) && (
              <p className={styles.searchNote} aria-live="polite">
                Ничего не нашлось. Попробуй номер задания или другое слово.
              </p>
            )}
            {groups.map((group) => (
              <section key={group.id} className={styles.group}>
                <h2 className={styles.groupTitle}>{group.title}</h2>
                <ul className={styles.items}>
                  {group.specs.map((spec) => {
                    const ready = materialsOf(spec).length > 0;
                    const isNew = spec.topics.some((b) => b.relation === 'new');
                    return (
                      <li key={spec.number}>
                        <button
                          type="button"
                          className={clsx(
                            styles.item,
                            spec.number === taskNumber && styles.itemActive,
                            !ready && styles.itemEmpty,
                          )}
                          aria-current={spec.number === taskNumber ? 'true' : undefined}
                          aria-label={`№${spec.number}. ${spec.title} — ${ready ? 'теория готова' : 'теория готовится'}`}
                          onClick={() => open(spec)}
                        >
                          <span className={styles.number}>{spec.number}</span>
                          <span className={styles.itemText}>
                            <span className={styles.itemTitle}>
                              {spec.title}
                              {isNew && <span className={mathStyles.newBadge}>новое</span>}
                            </span>
                            <span className={styles.itemMeta}>
                              {ready ? 'теория готова' : 'готовится'}
                            </span>
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
                <p className={styles.kicker}>
                  ЕГЭ-{selected.year} · задание №{selected.number}
                </p>
                <h2 id="theory-task-title" className="text-h2">
                  {selected.title}
                </h2>
                {selected.topics.map((binding) => (
                  <MathTopicTheory
                    key={binding.topicKey}
                    topicKey={binding.topicKey}
                    note={binding.status === 'secondary' ? binding.note : undefined}
                    partOf={binding.relation === 'part-of'}
                    showTitle={selected.topics.length > 1}
                  />
                ))}
              </article>
            ) : (
              <div className={styles.placeholder}>
                <Icon name="reference" size={28} />
                <p className="text-body" style={{ fontWeight: 700 }}>
                  Выбери номер задания
                </p>
                <p className="text-body-sm text-secondary">
                  Номера — как в ЕГЭ-{year}. Переключи год, если готовишься по другой спецификации:
                  теория та же, меняются только номера.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
