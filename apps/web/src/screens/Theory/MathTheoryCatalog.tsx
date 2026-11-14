import { useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  EXAM_TASK_SPECS,
  EXAM_TOPICS,
  examEdition,
  type ExamEditionId,
  type ExamTaskSpec,
} from '@zybrilka/shared';
import {
  codifierExtras,
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

export const DEFAULT_MATH_EDITION: ExamEditionId = 'ege-2027';

const sectionTabs = [
  { id: 'rules', label: 'Теория' },
  { id: 'materials', label: 'Полезные материалы' },
] as const;

// ЕГЭ-2026 and the current ЕГЭ-2027 share one numbering (FIPI: «Изменений
// нет»), so they share one tab; the old Ященко-2027 edition has its own.
const editionTabs = [
  { id: 'ege-2027', label: 'ЕГЭ-2027 / 2026' },
  { id: 'ege-2027-project', label: 'Ященко-2027 · старая редакция' },
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
  edition?: ExamEditionId;
  taskNumber?: number;
  topic?: string;
}

/**
 * Profile-math theory by exam number, in the numbering of the chosen year
 * (docs/theory/EXAM-NUMBERING.md). Each number opens the theory of its
 * topic(s); the same topic is reached from both years without copies.
 */
export function MathTheoryCatalog({
  section,
  edition: editionProp,
  taskNumber,
  topic,
}: MathTheoryCatalogProps) {
  const { navigate } = useNavigation();
  const edition = editionProp ?? DEFAULT_MATH_EDITION;
  const editionInfo = examEdition(edition)!;
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query).trim().toLowerCase().replace(/^№\s*/, '');
  const readerRef = useRef<HTMLDivElement>(null);
  const pushedFromList = useRef(false);

  const specs = EXAM_TASK_SPECS.filter((s) => s.subjectId === 'math' && s.edition === edition);
  const extras = codifierExtras(edition);
  const selectedExtra = topic ? (extras.find((x) => x.topicKey === topic) ?? null) : null;
  const selected = selectedExtra ? null : (specs.find((s) => s.number === taskNumber) ?? null);

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
  }, [taskNumber, topic, edition]);

  function go(
    next: { edition?: ExamEditionId; taskNumber?: number; topic?: string },
    replace = false,
  ) {
    navigate(
      {
        screen: 'theory',
        section,
        subject: 'math',
        edition: next.edition ?? edition,
        ...(next.topic ? { topic: next.topic } : {}),
        ...(next.taskNumber ? { taskNumber: next.taskNumber } : {}),
      },
      replace ? { replace: true } : undefined,
    );
  }

  function open(spec: ExamTaskSpec) {
    pushedFromList.current = true;
    go({ taskNumber: spec.number });
  }

  function openTopic(topicKey: string) {
    pushedFromList.current = true;
    go({ topic: topicKey });
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
            Профильная математика · теория по номерам заданий. Одна тема — один текст для всех
            редакций экзамена.
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
                  edition,
                  ...(taskNumber ? { taskNumber } : {}),
                },
                { replace: true },
              )
            }
          />
          <Tabs
            aria-label="Нумерация"
            items={editionTabs}
            activeId={edition === 'ege-2026' ? 'ege-2027' : edition}
            onChange={(id) => go({ edition: id as ExamEditionId }, true)}
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
            <p
              className={clsx(
                mathStyles.editionNote,
                editionInfo.superseded && mathStyles.editionOld,
              )}
            >
              {edition === 'ege-2027-project'
                ? 'Нумерация старого сборника Ященко-2027: он составлен по проекту КИМ (август 2026), который не вошёл в окончательную редакцию. В актуальном ЕГЭ-2027 19 заданий, как в 2026 году.'
                : 'Нумерация ЕГЭ-2027 по спецификации ФИПИ от 13.11.2026 — та же, что в ЕГЭ-2026: изменений нет.'}
            </p>
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
            {extras.length > 0 && !q && (
              <section className={styles.group}>
                <h2 className={styles.groupTitle}>По кодификатору — без отдельного номера</h2>
                <ul className={styles.items}>
                  {extras.map((x) => (
                    <li key={x.topicKey}>
                      <button
                        type="button"
                        className={clsx(styles.item, x.topicKey === topic && styles.itemActive)}
                        aria-current={x.topicKey === topic ? 'true' : undefined}
                        onClick={() => openTopic(x.topicKey)}
                      >
                        <span className={styles.number}>
                          <Icon name="topic" size={14} />
                        </span>
                        <span className={styles.itemText}>
                          <span className={styles.itemTitle}>{topicTitle(x.topicKey)}</span>
                          <span className={styles.itemMeta}>
                            {mathMaterialFor(x.topicKey) ? 'теория готова' : 'готовится'}
                          </span>
                        </span>
                        <Icon name="chevronRight" size={16} className={styles.chevron} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </nav>

          <div className={styles.reader} ref={readerRef}>
            {selectedExtra ? (
              <article className={styles.article} aria-labelledby="theory-task-title">
                <button type="button" className={styles.backToList} onClick={backToList}>
                  <Icon name="back" size={18} /> Все задания
                </button>
                <p className={styles.kicker}>{editionInfo.shortTitle} · по кодификатору</p>
                <h2 id="theory-task-title" className="text-h2">
                  {topicTitle(selectedExtra.topicKey)}
                </h2>
                <MathTopicTheory
                  topicKey={selectedExtra.topicKey}
                  note={selectedExtra.note}
                  partOf={false}
                  showTitle={false}
                />
              </article>
            ) : selected ? (
              <article className={styles.article} aria-labelledby="theory-task-title">
                <button type="button" className={styles.backToList} onClick={backToList}>
                  <Icon name="back" size={18} /> Все задания
                </button>
                <p className={styles.kicker}>
                  {editionInfo.shortTitle} · задание №{selected.number}
                </p>
                <h2 id="theory-task-title" className="text-h2">
                  {selected.title}
                </h2>
                {selected.topics.map((binding) => (
                  <MathTopicTheory
                    key={binding.topicKey}
                    topicKey={binding.topicKey}
                    note={
                      binding.status !== 'official' || binding.relation !== 'same'
                        ? binding.note
                        : undefined
                    }
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
                  {edition === 'ege-2027-project'
                    ? 'Номера — как в старом сборнике Ященко-2027. Теория та же, меняются только номера.'
                    : 'Номера — как в ЕГЭ-2027 и ЕГЭ-2026 (они совпадают).'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
