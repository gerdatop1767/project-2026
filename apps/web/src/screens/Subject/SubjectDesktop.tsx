import { useEffect, useState } from 'react';
import type { CollectionListItem, ProgressByTopicResponse, TaskPublic } from '@zybrilka/shared';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { startCustomVariant, startRealTask } from '../../lib/startTraining.js';
import {
  getProgressByTopic,
  getProgressSummary,
  getTaskCountsBySubject,
  listCollections,
} from '../../lib/api.js';
import { getSubjectContent, type SubjectModeId } from '../../data/subjectContent.js';
import { BackRow, type BackRowProps } from '../../ui/BackRow/BackRow.js';
import { Card } from '../../ui/Card/Card.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { Select } from '../../ui/Select/Select.js';
import { ProgressBar } from '../../ui/Progress/ProgressBar.js';
import { CircularProgress } from '../../ui/Progress/CircularProgress.js';
import { FavoritesList } from '../../ui/Favorites/FavoritesList.js';
import { clsx } from '../../lib/clsx.js';
import { FadeIn } from '../../ui/motion/motion.js';
import styles from './SubjectDesktop.module.css';

/** Sentinel Select value for "Общий банк" (no collection filter) — Select's
 * own value type is `string | null`, and `null` there means "nothing
 * picked yet", not a deliberate "every source" choice, so this needs its
 * own explicit, always-visible option instead of just an empty selection. */
const ALL_SOURCES_VALUE = '__all__';

function sourceSelectOptions(collections: readonly CollectionListItem[]) {
  return [
    { value: ALL_SOURCES_VALUE, label: 'Общий банк' },
    ...collections.map((item) => ({ value: item.collection.slug, label: item.collection.title })),
  ];
}

export interface SubjectDesktopProps {
  subjectId: string;
  from?: 'subjectCatalog' | 'learningCenter';
  /** Pre-selects the "Источник" filter (e.g. arriving back from a task
   * opened under a specific collection) — see navigation.tsx. */
  collectionSlug?: string;
  /** Opens straight into this mode tab (e.g. Result's "К списку
   * заданий" wants "По номерам") instead of the default "Темы". */
  initialMode?: SubjectModeId;
}

type TopicProgressItem = ProgressByTopicResponse['items'][number];

const modes: readonly {
  id: SubjectModeId | 'byNumber';
  label: string;
  caption: string;
  icon: IconName;
}[] = [
  { id: 'topics', label: 'Темы', caption: 'Все темы по номерам', icon: 'reference' },
  {
    id: 'byNumber',
    label: 'Задания по номерам',
    caption: 'Выбрать конкретное задание',
    icon: 'checklist',
  },
  { id: 'variants', label: 'Варианты', caption: 'Полные варианты ЕГЭ', icon: 'variant' },
  { id: 'favorites', label: 'Избранное', caption: 'Сохранённые задания', icon: 'favorite' },
];

/**
 * Desktop Subject page (approved references: 01_MATH…09_HISTORY_
 * DESKTOP.png) — one generic component for every subject. Per-subject
 * differences (topics, tagline, task-number count) come entirely from
 * `data/subjectContent.ts`; adding a 10th subject means adding data
 * there, never copying this component. `mode` and the topic/number
 * drill-downs are local state, not global routes — there's nothing
 * here a deep link needs to restore, and it keeps this screen's own
 * back-stack (topic/number → list) independent of the app router's.
 */
export function SubjectDesktop({
  subjectId,
  from,
  collectionSlug,
  initialMode,
}: SubjectDesktopProps) {
  const { navigate } = useNavigation();
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]!;
  const content = getSubjectContent(subject.id);

  const [mode, setMode] = useState<SubjectModeId>(initialMode ?? 'topics');
  const [selectedTopic, setSelectedTopic] = useState<TopicProgressItem | null>(null);
  const [collections, setCollections] = useState<readonly CollectionListItem[]>([]);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [topicsSlug, setTopicsSlug] = useState<string | null>(collectionSlug ?? null);
  const [topics, setTopics] = useState<readonly TopicProgressItem[]>([]);
  // Real solved count + accuracy for this subject/user (Block D's
  // `bySubject`), and real published-task count — replaces the static
  // `subject.taskCount`/`mastery` demo fields. null until loaded — never
  // a `0` placeholder masquerading as a real "0 solved / 0% accuracy"
  // (see SubjectMobile.tsx for why: same component shape, same bug).
  // "Решено" is `uniqueSolved` (distinct tasks with >=1 correct
  // attempt), NOT `solved` (an attempt-row count — re-solving one task
  // 100 times used to show "100 решено"; see the nav/stats bugfix
  // report). `accuracyPercent` stays the existing attempt-based metric,
  // unchanged.
  const [solved, setSolved] = useState<number | null>(null);
  const [accuracyPercent, setAccuracyPercent] = useState<number | null>(null);
  const [totalTasks, setTotalTasks] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProgressSummary()
      .then((data) => {
        if (cancelled) return;
        const entry = data.bySubject.find((s) => s.subjectId === subject.id);
        setSolved(entry?.uniqueSolved ?? 0);
        setAccuracyPercent(entry ? Math.round(entry.accuracyPercent) : 0);
      })
      .catch(() => {
        if (!cancelled) {
          setSolved(0);
          setAccuracyPercent(0);
        }
      });
    void getTaskCountsBySubject()
      .then((res) => {
        if (cancelled) return;
        const entry = res.items.find((i) => i.subjectId === subject.id);
        setTotalTasks(entry?.count ?? 0);
      })
      .catch(() => {
        if (!cancelled) setTotalTasks(0);
      });
    return () => {
      cancelled = true;
    };
  }, [subject.id]);

  // Real collections for this subject — "Источник" always offers "Общий
  // банк" plus whatever collections/variants exist, generically, never a
  // hardcoded publisher. An unreachable API just leaves the list empty:
  // every mode still works against the aggregate bank.
  useEffect(() => {
    let cancelled = false;
    void listCollections()
      .then((items) => {
        if (cancelled) return;
        setCollections(items.filter((item) => item.collection.subjectId === subject.id));
        setCollectionsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setCollectionsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [subject.id]);

  // A slug carried in from the route (or picked earlier) might name a
  // collection that no longer exists/isn't published for this subject —
  // derived (not synced via an effect) so it falls back to "Общий банк"
  // the moment the real list loads, without a set-state-in-effect round trip.
  const knownSlugs = new Set(collections.map((item) => item.collection.slug));
  const effectiveTopicsSlug =
    collectionsLoaded && topicsSlug && !knownSlugs.has(topicsSlug) ? null : topicsSlug;

  // Real topics (Block D) — the DB's own topics table, never the static
  // per-subject design content, whose ids/names are a different,
  // incompatible taxonomy. A topic with no published task in the
  // current scope simply doesn't appear rather than showing a fake 0/0.
  useEffect(() => {
    let cancelled = false;
    void getProgressByTopic({
      subject: subject.id,
      collection: effectiveTopicsSlug ?? undefined,
    })
      .then((res) => {
        if (!cancelled) setTopics(res.items);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subject.id, effectiveTopicsSlug]);

  // Where Task's back arrow returns — this subject page in whichever
  // mode/source is currently active (audit Block 3), so Subject → Task
  // → Back lands back here instead of falling through to Home.
  function currentReturnTo(): Route {
    const slug =
      mode === 'topics' ? (effectiveTopicsSlug ?? undefined) : (collectionSlug ?? undefined);
    return { screen: 'subject', subjectId: subject.id, collectionSlug: slug, initialMode: mode };
  }

  function startTraining(taskNumber: number, collection?: string) {
    startRealTask(navigate, {
      subject: subject.id,
      taskNumber,
      collection,
      returnTo: currentReturnTo(),
    });
  }

  function startVariant(taskNumbers: readonly number[], collection?: string) {
    startCustomVariant(navigate, {
      subject: subject.id,
      taskNumbers,
      collection,
      returnTo: currentReturnTo(),
    });
  }

  function startTopicTraining(topic: TopicProgressItem) {
    startRealTask(navigate, {
      subject: subject.id,
      topic: topic.topicId,
      collection: effectiveTopicsSlug ?? undefined,
      returnTo: currentReturnTo(),
    });
  }

  function handleSelectFavorite(task: TaskPublic) {
    navigate({
      screen: 'task',
      subjectId: task.subjectId,
      taskNumber: task.taskNumber,
      taskId: task.id,
      returnTo: currentReturnTo(),
    });
  }

  const parentLabel = from === 'learningCenter' ? 'К учебному центру' : 'К предметам';
  const parentScreen: 'subjectCatalog' | 'learningCenter' = from ?? 'subjectCatalog';
  const backProps: BackRowProps = selectedTopic
    ? { onBack: () => setSelectedTopic(null), label: subject.shortName }
    : { to: { screen: parentScreen }, label: parentLabel };

  return (
    <FadeIn>
      <BackRow {...backProps} />

      <div className={styles.hero}>
        <div
          className={styles.heroIllustration}
          style={{ ['--subject-accent' as string]: subject.color }}
        >
          <img
            src={`/branding/v2/subjects/${subject.id}.png`}
            alt=""
            aria-hidden="true"
            className={styles.heroImg}
          />
        </div>
        <div className={styles.heroText}>
          <h1 className="text-h1">{subject.shortName}</h1>
          <p className="text-body-sm text-secondary">{content.tagline}</p>
          <div className={styles.heroStats}>
            <span className={styles.heroStat}>
              <Icon name="target" size={16} />
              <strong>{solved ?? '···'}</strong> заданий решено
            </span>
            <span className={styles.heroStat}>
              <Icon name="progress" size={16} />
              <strong>{accuracyPercent !== null ? `${accuracyPercent}%` : '···'}</strong> средняя точность
            </span>
          </div>
        </div>
      </div>

      <div className={styles.modes}>
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={clsx(styles.modeButton, mode === item.id && styles.modeButtonActive)}
            onClick={() => {
              if (item.id === 'byNumber') {
                navigate({
                  screen: 'trainingByNumber',
                  subjectId: subject.id,
                  collectionSlug: effectiveTopicsSlug ?? undefined,
                  from: currentReturnTo(),
                });
                return;
              }
              setMode(item.id);
              setSelectedTopic(null);
            }}
          >
            <Icon name={item.icon} size={18} />
            <span>
              <span className={styles.modeLabel}>{item.label}</span>
              <span className={styles.modeCaption}>{item.caption}</span>
            </span>
          </button>
        ))}
      </div>

      <div className={styles.grid}>
        <div className={styles.main}>
          {mode === 'topics' && !selectedTopic && (
            <TopicsList
              topics={topics}
              collections={collections}
              selectedSlug={effectiveTopicsSlug}
              onSourceChange={setTopicsSlug}
              onSelect={setSelectedTopic}
            />
          )}
          {mode === 'topics' && selectedTopic && (
            <TopicDetail
              subjectName={subject.shortName}
              topic={selectedTopic}
              onStart={() => startTopicTraining(selectedTopic)}
            />
          )}
          {mode === 'variants' && (
            <VariantBuilder
              taskNumberCount={content.taskNumberCount}
              collections={collections}
              onStart={startVariant}
            />
          )}
          {mode === 'favorites' && (
            <Card>
              <p className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>
                Избранное
              </p>
              <FavoritesList subjectId={subject.id} onSelect={handleSelectFavorite} />
            </Card>
          )}
        </div>

        <div className={styles.sidebar}>
          <Card>
            <p className="text-h3">Твой прогресс</p>
            <div className={styles.progressRing}>
              <CircularProgress value={accuracyPercent ?? 0} size={110} strokeWidth={10}>
                <span className="text-h2">{accuracyPercent !== null ? `${accuracyPercent}%` : '···'}</span>
              </CircularProgress>
            </div>
            <p className="text-body-sm text-secondary" style={{ textAlign: 'center' }}>
              {solved ?? '···'} из {totalTasks ?? '—'} заданий решено
            </p>
          </Card>

          <Card>
            <p className="text-h3">Быстрый старт</p>
            <div className={styles.quickList}>
              <button type="button" className={styles.quickRow} onClick={() => startTraining(1)}>
                <Icon name="play" size={18} />
                <span>
                  <p className="text-body-sm" style={{ fontWeight: 700 }}>
                    Продолжить
                  </p>
                  <p className="text-body-sm text-secondary">Тема {content.topics[0]!.title}</p>
                </span>
                <Icon name="arrowRight" size={16} className={styles.quickArrow} />
              </button>
              <button
                type="button"
                className={styles.quickRow}
                onClick={() => navigate({ screen: 'training' })}
              >
                <Icon name="smart" size={18} />
                <span>
                  <p className="text-body-sm" style={{ fontWeight: 700 }}>
                    Случайное задание
                  </p>
                  <p className="text-body-sm text-secondary">Любая тема — в Тренировке</p>
                </span>
                <Icon name="arrowRight" size={16} className={styles.quickArrow} />
              </button>
              <button
                type="button"
                className={styles.quickRow}
                onClick={() => {
                  setMode('variants');
                  setSelectedTopic(null);
                }}
              >
                <Icon name="variant" size={18} />
                <span>
                  <p className="text-body-sm" style={{ fontWeight: 700 }}>
                    Решить вариант
                  </p>
                  <p className="text-body-sm text-secondary">Полный вариант ЕГЭ</p>
                </span>
                <Icon name="arrowRight" size={16} className={styles.quickArrow} />
              </button>
            </div>
          </Card>

          <Card>
            <p className="text-h3">Последние решения</p>
            <p className="text-body-sm text-secondary" style={{ marginTop: 'var(--space-2)' }}>
              Пока нет данных о недавних решениях.
            </p>
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}

function TopicsList({
  topics,
  collections,
  selectedSlug,
  onSourceChange,
  onSelect,
}: {
  topics: readonly TopicProgressItem[];
  collections: readonly CollectionListItem[];
  selectedSlug: string | null;
  onSourceChange: (slug: string | null) => void;
  onSelect: (topic: TopicProgressItem) => void;
}) {
  return (
    <Card>
      <div className={styles.numberGridHeader}>
        <div>
          <p className="text-h3">Темы ЕГЭ</p>
          <p className="text-body-sm text-secondary">Реальные темы из базы заданий</p>
        </div>
        <div className={styles.sourceSelect}>
          <span className="text-body-sm text-secondary">Источник:</span>
          <Select
            options={sourceSelectOptions(collections)}
            value={selectedSlug ?? ALL_SOURCES_VALUE}
            onChange={(value) => onSourceChange(value === ALL_SOURCES_VALUE ? null : value)}
            sheetTitle="Источник"
          />
        </div>
      </div>
      <div className={styles.topicList}>
        {topics.length === 0 && (
          <p className="text-body-sm text-secondary">В этом источнике пока нет тем.</p>
        )}
        {topics.map((topic) => {
          const percent = topic.total > 0 ? Math.round((topic.completed / topic.total) * 100) : 0;
          return (
            <button
              key={topic.topicId}
              type="button"
              className={styles.topicRow}
              onClick={() => onSelect(topic)}
            >
              <span className={styles.topicBody}>
                <p className="text-body" style={{ fontWeight: 700 }}>
                  {topic.topicName}
                </p>
              </span>
              <span className={styles.topicStats}>
                <span className="text-body-sm text-secondary">
                  {topic.completed} / {topic.total} решено
                </span>
                <ProgressBar value={percent} />
              </span>
              <Icon name="chevronRight" size={18} className={styles.topicArrow} />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function TopicDetail({
  subjectName,
  topic,
  onStart,
}: {
  subjectName: string;
  topic: TopicProgressItem;
  onStart: () => void;
}) {
  const percent = topic.total > 0 ? Math.round((topic.completed / topic.total) * 100) : 0;
  return (
    <Card>
      <p className="text-h2">{topic.topicName}</p>
      <p className="text-body-sm text-secondary" style={{ marginTop: 'var(--space-1)' }}>
        {subjectName}
      </p>
      <div className={styles.topicDetailStats}>
        <span className="text-body-sm text-secondary">
          {topic.completed} / {topic.total} решено
        </span>
        <ProgressBar value={percent} />
      </div>
      <Button
        variant="primary"
        onClick={onStart}
        disabled={topic.total === 0}
        style={{ marginTop: 'var(--space-4)' }}
      >
        Начать тренировку <Icon name="arrowRight" size={16} />
      </Button>
    </Card>
  );
}

function VariantBuilder({
  taskNumberCount,
  collections,
  onStart,
}: {
  taskNumberCount: number;
  collections: readonly CollectionListItem[];
  onStart: (taskNumbers: readonly number[], collection?: string) => void;
}) {
  const allNumbers = Array.from({ length: taskNumberCount }, (_, i) => i + 1);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const activeSourceLabel =
    collections.find((item) => item.collection.slug === selectedSlug)?.collection.title ??
    'Общий банк';

  function toggleNumber(number: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) {
        next.delete(number);
      } else {
        next.add(number);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allNumbers));
  }

  function reset() {
    setSelected(new Set());
  }

  const allSelected = selected.size === allNumbers.length;
  const sortedSelected = [...selected].sort((a, b) => a - b);

  return (
    <Card>
      <p className="text-h3">Полные варианты ЕГЭ</p>
      <p className="text-body-sm text-secondary">
        Собери собственный вариант из нужных заданий и источников
      </p>

      <p className={styles.builderStepLabel}>1. Выбери источник</p>
      <div className={styles.sourceSelect}>
        <Select
          options={sourceSelectOptions(collections)}
          value={selectedSlug ?? ALL_SOURCES_VALUE}
          onChange={(value) => setSelectedSlug(value === ALL_SOURCES_VALUE ? null : value)}
          sheetTitle="Источник"
        />
      </div>

      <div className={styles.builderStepHeader}>
        <p className={styles.builderStepLabel}>2. Выбери номера заданий</p>
        <button
          type="button"
          className={styles.selectAllRow}
          onClick={() => (allSelected ? reset() : selectAll())}
        >
          <span className={clsx(styles.checkbox, allSelected && styles.checkboxChecked)}>
            {allSelected && <Icon name="check" size={14} />}
          </span>
          Выбрать всё
        </button>
      </div>
      <div className={styles.numberChipGrid}>
        {allNumbers.map((number) => (
          <button
            key={number}
            type="button"
            className={clsx(styles.numberChip, selected.has(number) && styles.numberChipActive)}
            onClick={() => toggleNumber(number)}
          >
            {number}
          </button>
        ))}
      </div>

      <div className={styles.builderSummary}>
        <Icon name="variant" size={18} />
        <span className={styles.builderSummaryBody}>
          <p className="text-body-sm" style={{ fontWeight: 700 }}>
            Выбрано {selected.size} заданий
          </p>
          <p className="text-body-sm text-secondary">
            {selected.size > 0 ? `Номера: ${sortedSelected.join(', ')}` : 'Номера не выбраны'} ·
            Источник: {activeSourceLabel}
          </p>
        </span>
        <Button variant="secondary" onClick={reset} disabled={selected.size === 0}>
          <Icon name="retry" size={16} /> Сбросить
        </Button>
      </div>

      <Button
        variant="primary"
        fullWidth
        disabled={selected.size === 0}
        onClick={() => onStart(sortedSelected, selectedSlug ?? undefined)}
        style={{ marginTop: 'var(--space-4)' }}
      >
        <Icon name="play" size={16} /> Собрать вариант и начать решать
      </Button>
    </Card>
  );
}
