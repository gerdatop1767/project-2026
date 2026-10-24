import { useEffect, useState } from 'react';
import { trackSubject } from '../../lib/analytics.js';
import { useNavigation } from '../../lib/navigation.js';
import { getSubjectContent } from '../../data/subjectContent.js';
import {
  getProgressByTopic,
  getRandomTask,
  getTopics,
  getVariant,
  listCollections,
  startLearningSession,
  startVariantSession,
} from '../../lib/api.js';
import { useAccountGate, type AccountFeature } from '../../lib/accountGate.js';
import type { CollectionListItem, ProgressByTopicResponse } from '@zybrilka/shared';
import {
  applyLearningSessionResponse,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import { resolveTaskBatch, shuffled, type TaskPickFilter } from '../../lib/startTraining.js';
import { Button } from '../../ui/Button/Button.js';
import { Chip } from '../../ui/Chip/Chip.js';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { Input } from '../../ui/Input/Input.js';
import { Select } from '../../ui/Select/Select.js';
import { SectionHeader } from '../../ui/SectionHeader/SectionHeader.js';
import { clsx } from '../../lib/clsx.js';
import { ContentSwap, SlideUp } from '../../ui/motion/motion.js';
import { SubjectSelect } from '../../ui/SubjectPicker/SubjectPicker.js';
import { TopicPicker } from '../../ui/Training/TopicPicker.js';
import styles from './Training.module.css';

type TopicItem = ProgressByTopicResponse['items'][number];
type AmountId = 'infinite' | '5' | '10' | '20' | 'custom';
/** A reasonable upper bound for "Своё число" — guards against hammering
 * the API with an unbounded sequential loop, never a backend limit. */
const MAX_CUSTOM_AMOUNT = 50;

interface TrainingMode {
  id: 'topic' | 'mistakes' | 'smart' | 'variant';
  icon: IconName;
  label: string;
  description: string;
  /** One of the existing status/accent tokens — never a new color. */
  accent: string;
}

const trainingModes: readonly TrainingMode[] = [
  {
    id: 'topic',
    icon: 'topic',
    label: 'По теме',
    description: 'Реальные темы предмета из базы заданий',
    accent: 'var(--color-accent-primary)',
  },
  {
    id: 'mistakes',
    icon: 'mistakes',
    label: 'Мои ошибки',
    description: 'Разбери задания, где были ошибки',
    accent: 'var(--color-error)',
  },
  {
    id: 'smart',
    icon: 'smart',
    label: 'Умная тренировка',
    description: 'Подбор заданий под твой прогресс',
    accent: 'var(--color-success)',
  },
  {
    id: 'variant',
    icon: 'variant',
    label: 'Вариант',
    description: 'Полный вариант ЕГЭ на время',
    accent: 'var(--color-accent-secondary)',
  },
];

const smartQuantityOptions = ['5', '10'];

const amountOptions: readonly { id: AmountId; icon: IconName; label: string }[] = [
  { id: 'infinite', icon: 'infinite', label: 'Без ограничения' },
  { id: '5', icon: 'checklist', label: '5' },
  { id: '10', icon: 'checklist', label: '10' },
  { id: '20', icon: 'checklist', label: '20' },
  { id: 'custom', icon: 'edit', label: 'Своё число' },
];

/**
 * Training (Design Spec Section 7): subject → mode → the selected
 * mode's own settings, then into Task. No "Быстрый старт" shortcuts —
 * those live one level up, as the three real 🎲/🔄/🔢 entry points
 * already offered elsewhere (the Subject page's own modes, incl. По номерам).
 *
 * "По теме" is wired to real topics (`GET /progress/by-topic`, the
 * same data Subject's "Темы" tab already uses) with independent
 * 🎲 Случайное / 🔄 Только нерешённые and an optional task-number
 * narrowing — never both mutually exclusive. "Вариант" opens one of
 * the selected Сборник's real variants, picked manually or via the
 * same two independent toggles. "Мои ошибки" jumps straight to the
 * real Mistakes screen. "Умная тренировка" is untouched — the real
 * backend learning session, its own `limit`.
 */
/** Modes built from a personal history — a guest is told they need an account. */
const accountModes: Partial<Record<TrainingMode['id'], AccountFeature>> = {
  mistakes: 'mistakes',
  smart: 'smartTraining',
};

/** The EGE numbers to offer inside a topic: the ones its tasks really
 * have (from the API), or — for an older API response without them —
 * every number of the subject. */
function topicNumbersFor(topic: TopicItem | null, subjectId: string): number[] {
  if (topic?.taskNumbers && topic.taskNumbers.length > 0) return topic.taskNumbers;
  return Array.from({ length: getSubjectContent(subjectId).taskNumberCount }, (_, i) => i + 1);
}

export function Training() {
  const { navigate } = useNavigation();
  const { isGuest, requireAccount } = useAccountGate();

  /** «Только нерешённые» needs to know what you solved — an account. */
  function toggleUnseen(on: boolean, set: (value: boolean) => void) {
    if (!on && !requireAccount('unseen')) return;
    set(!on);
  }
  const { setSession } = useLearningSessionContext();
  const [subjectId, setSubjectId] = useState('math');
  const [modeId, setModeId] = useState<TrainingMode['id']>('topic');
  const [collections, setCollections] = useState<readonly CollectionListItem[]>([]);
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // "Вариант" — manual pick, or 🎲/🔄 (independent, both may be on).
  const [variantId, setVariantId] = useState<string | null>(null);
  const [variantRandom, setVariantRandom] = useState(false);
  const [variantUnseen, setVariantUnseen] = useState(false);

  // "Умная тренировка" — its own bounded `limit`, plus the same
  // independent 🎲/🔄 toggles "По теме" has (additive on the backend:
  // see GetLearningPathContext's unseenOnly/randomizeTopTier — no
  // scoring formula changes).
  const [smartQuantity, setSmartQuantity] = useState('5');
  const [smartRandom, setSmartRandom] = useState(false);
  const [smartUnseen, setSmartUnseen] = useState(false);

  // "По теме" — real topics, independent 🎲/🔄, optional numbers, amount.
  const [topics, setTopics] = useState<readonly TopicItem[]>([]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [topicRandom, setTopicRandom] = useState(false);
  const [topicUnseen, setTopicUnseen] = useState(false);
  const [topicNumbers, setTopicNumbers] = useState<ReadonlySet<number>>(new Set());
  const [amount, setAmount] = useState<AmountId>('infinite');
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listCollections()
      .then((items) => {
        if (!cancelled) setCollections(items.filter((c) => c.collection.subjectId === subjectId));
      })
      .catch(() => {
        // "Сборник" simply stays empty/unavailable — остальные режимы
        // по-прежнему работают без него.
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  // Real topics (the same `GET /progress/by-topic` Subject's "Темы"
  // tab already uses) — never a static/fake list.
  useEffect(() => {
    let cancelled = false;
    // A guest gets the public topic list (same shape, nothing personal).
    const loadTopics = isGuest ? getTopics : getProgressByTopic;
    void loadTopics({ subject: subjectId, collection: collectionSlug ?? undefined })
      .then((res) => {
        if (!cancelled) setTopics(res.items);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, collectionSlug, isGuest]);

  function selectSubject(id: string) {
    trackSubject(id);
    setSubjectId(id);
    setTopicId(null);
    setTopicNumbers(new Set());
    setVariantId(null);
  }

  function selectTopic(id: string | null) {
    setTopicId(id);
    // Numbers belong to a topic: a new topic starts with none picked.
    setTopicNumbers(new Set());
  }

  function handleSelectCollection(slug: string) {
    setCollectionSlug(slug === collectionSlug ? null : slug);
    setVariantId(null);
  }

  function toggleTopicNumber(number: number) {
    setTopicNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }

  const selectedCollection = collections.find((c) => c.collection.slug === collectionSlug) ?? null;
  const selectedTopic = topics.find((t) => t.topicId === topicId) ?? null;

  /** Which real variant to open: manual pick when both toggles are off,
   * otherwise picked among `selectedCollection.variants` — 🎲 widens
   * the candidate order to a random one instead of the listed order,
   * 🔄 skips any variant with no unseen task left (checked via the
   * same real `unseen` filter `getRandomTask` already exposes — no new
   * backend concept of "an unseen variant"). */
  async function resolveVariantId(): Promise<string | null | 'exhausted'> {
    const variants = selectedCollection?.variants ?? [];
    if (variants.length === 0) return null;
    if (!variantRandom && !variantUnseen) return variantId;

    const order = variantRandom ? shuffled(variants) : variants;
    if (!variantUnseen) return order[0]!.id;

    for (const v of order) {
      try {
        await getRandomTask({ subject: subjectId, variant: v.id, unseen: true });
        return v.id;
      } catch {
        continue;
      }
    }
    return 'exhausted';
  }

  async function handleStart() {
    setStartError(null);
    if (modeId === 'mistakes') {
      navigate({ screen: 'mistakes' });
      return;
    }

    setStarting(true);
    try {
      if (modeId === 'smart') {
        const response = await startLearningSession({
          subjectId,
          limit: Number(smartQuantity),
          unseenOnly: smartUnseen,
          randomizeTopTier: smartRandom,
        });
        const outcome = applyLearningSessionResponse(response, setSession, navigate);
        if (outcome === 'none') {
          setStartError('Не нашлось подходящих заданий для умной тренировки.');
        }
        return;
      }

      if (modeId === 'variant') {
        const resolved = await resolveVariantId();
        if (resolved === 'exhausted') {
          setStartError(
            'Нет вариантов с нерешёнными заданиями — попробуй выключить «Только нерешённые».',
          );
          return;
        }
        if (!resolved) {
          setStartError('Выбери вариант, чтобы начать.');
          return;
        }
        // A guest: the variant's own tasks, in order, in the normal task
        // screen — the tracked variant session needs an account.
        if (isGuest) {
          const detail = await getVariant(resolved);
          const first = detail.tasks[0];
          if (!first) {
            setStartError('Не удалось начать вариант — попробуй ещё раз.');
            return;
          }
          navigate({
            screen: 'task',
            subjectId: first.task.subjectId,
            taskNumber: first.task.taskNumber,
            taskId: first.task.id,
            variantId: resolved,
            collectionSlug: collectionSlug ?? undefined,
            customOrderedTasks: detail.tasks.map((t) => ({
              taskId: t.task.id,
              taskNumber: t.task.taskNumber,
            })),
            returnTo: { screen: 'training' },
          });
          return;
        }
        // A real VARIANT session (Statistics 2.0's "Статистика
        // вариантов" + the shared LearningSession completion screen —
        // same backend session lifecycle Smart Training uses, just
        // over the variant's own real task order, never scored).
        const response = await startVariantSession(resolved);
        const outcome = applyLearningSessionResponse(response, setSession, navigate);
        if (outcome === 'none') {
          setStartError('Не удалось начать вариант — попробуй ещё раз.');
        }
        return;
      }

      // modeId === 'topic'
      if (!topicId) {
        setStartError('Выбери тему, чтобы начать.');
        return;
      }
      const numbers = [...topicNumbers].sort((a, b) => a - b);
      let filters: TaskPickFilter[];
      if (numbers.length > 0) {
        filters = numbers.map((taskNumber) => ({
          subject: subjectId,
          topic: topicId,
          taskNumber,
          collection: collectionSlug ?? undefined,
          random: topicRandom,
          unseen: topicUnseen,
        }));
      } else {
        let count = 1;
        if (amount === 'custom') {
          const parsed = Number(customAmount);
          if (!Number.isInteger(parsed) || parsed < 1) {
            setStartError('Количество заданий должно быть положительным числом.');
            return;
          }
          count = Math.min(parsed, MAX_CUSTOM_AMOUNT);
        } else if (amount !== 'infinite') {
          count = Number(amount);
        }
        filters = Array.from({ length: count }, () => ({
          subject: subjectId,
          topic: topicId,
          collection: collectionSlug ?? undefined,
          random: topicRandom,
          unseen: topicUnseen,
        }));
      }

      const result = await resolveTaskBatch(filters);
      if ('error' in result) {
        if (result.error.reason === 'no_unseen_tasks') {
          setStartError(
            'Нерешённых заданий по этой теме больше нет — попробуй выключить «Только нерешённые».',
          );
        } else {
          setStartError('Не нашлось подходящих заданий — попробуй другие фильтры.');
        }
        return;
      }
      const first = result.tasks[0]!;
      navigate({
        screen: 'task',
        subjectId: first.subjectId,
        taskNumber: first.taskNumber,
        taskId: first.id,
        collectionSlug: collectionSlug ?? undefined,
        customOrderedTasks: result.tasks.map((t) => ({ taskId: t.id, taskNumber: t.taskNumber })),
        returnTo: { screen: 'training' },
      });
    } catch {
      setStartError('Не нашлось подходящих заданий — попробуй другие фильтры.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <SlideUp className={styles.stack}>
      <header className={styles.header}>
        <h1 className="text-h1">Тренировка</h1>
        <SubjectSelect
          label="Предмет"
          value={subjectId}
          onChange={selectSubject}
          className={styles.subject}
        />
      </header>

      <div>
        <SectionHeader title="Режим тренировки" />
        <div className={styles.modeGrid}>
          {trainingModes.map((mode) => {
            const selected = mode.id === modeId;
            return (
              <button
                key={mode.id}
                type="button"
                className={clsx(styles.modeCard, selected && styles.modeCardSelected)}
                aria-pressed={selected}
                data-locked={(isGuest && accountModes[mode.id] !== undefined) || undefined}
                onClick={() => {
                  const feature = accountModes[mode.id];
                  if (feature && !requireAccount(feature)) return;
                  setModeId(mode.id);
                }}
              >
                <span
                  className={styles.modeIcon}
                  style={{ ['--mode-accent' as string]: mode.accent }}
                >
                  <Icon name={mode.icon} size={20} />
                </span>
                <span className={styles.modeText}>
                  <span className="text-body">{mode.label}</span>
                  <span className="text-body-sm text-secondary">{mode.description}</span>
                </span>
                {isGuest && accountModes[mode.id] && (
                  <span className={styles.modeLock} aria-label="нужен вход">
                    <Icon name="lock" size={16} />
                  </span>
                )}
                {selected && (
                  <span className={styles.modeCheck}>
                    <Icon name="check" size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ContentSwap key={modeId}>
        {(modeId === 'topic' || modeId === 'variant') && collections.length > 0 && (
          <div>
            <SectionHeader title="Сборник" />
            <Select
              options={collections.map((c) => ({
                value: c.collection.slug,
                label: c.collection.title,
              }))}
              value={collectionSlug}
              onChange={handleSelectCollection}
              placeholder="Все источники"
            />
          </div>
        )}

        {modeId === 'variant' && (
          <>
            <div className={styles.chipRow}>
              <Chip
                icon="dice"
                selected={variantRandom}
                onClick={() => setVariantRandom((v) => !v)}
              >
                Случайный вариант
              </Chip>
              <Chip
                icon="retry"
                selected={variantUnseen}
                onClick={() => toggleUnseen(variantUnseen, setVariantUnseen)}
              >
                Только нерешённые
              </Chip>
            </div>

            {selectedCollection && selectedCollection.variants.length > 0 && (
              <div>
                <SectionHeader title="Вариант" />
                <div className={styles.chipRow}>
                  {selectedCollection.variants.map((v) => (
                    <Chip
                      key={v.id}
                      selected={v.id === variantId}
                      onClick={() => setVariantId(v.id)}
                      disabled={variantRandom || variantUnseen}
                    >
                      Вариант {v.variantNumber}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {modeId === 'topic' && (
          <>
            <div>
              <SectionHeader title="Тема" />
              {topics.length === 0 ? (
                <p className="text-body-sm text-secondary">
                  В этом источнике пока нет тем — попробуй сменить «Сборник».
                </p>
              ) : (
                <TopicPicker
                  key={`${subjectId}:${collectionSlug ?? ''}`}
                  subjectId={subjectId}
                  topics={topics}
                  selectedId={topicId}
                  onSelect={selectTopic}
                  showProgress={!isGuest}
                />
              )}
            </div>

            {topicId && (
              <>
                <div>
                  <SectionHeader title="Номера внутри темы (необязательно)" />
                  <div className={styles.chipRow}>
                    {topicNumbersFor(selectedTopic, subjectId).map((number) => (
                      <Chip
                        key={number}
                        selected={topicNumbers.has(number)}
                        onClick={() => toggleTopicNumber(number)}
                      >
                        №{number}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className={styles.settingsRow}>
                  <div>
                    <SectionHeader title="Режим выборки" />
                    <div className={styles.chipRow}>
                      <Chip
                        icon="dice"
                        selected={topicRandom}
                        onClick={() => setTopicRandom((v) => !v)}
                      >
                        Случайное
                      </Chip>
                      <Chip
                        icon="retry"
                        selected={topicUnseen}
                        onClick={() => toggleUnseen(topicUnseen, setTopicUnseen)}
                      >
                        Только нерешённые
                      </Chip>
                    </div>
                  </div>

                  {topicNumbers.size === 0 && (
                    <div>
                      <SectionHeader title="Количество заданий" />
                      <div className={styles.chipRow}>
                        {amountOptions.map((option) => (
                          <Chip
                            key={option.id}
                            icon={option.icon}
                            selected={amount === option.id}
                            onClick={() => setAmount(option.id)}
                          >
                            {option.label}
                          </Chip>
                        ))}
                      </div>
                      {amount === 'custom' && (
                        <Input
                          label="Сколько заданий"
                          placeholder="Например, 15"
                          inputMode="numeric"
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value.replace(/\D/g, ''))}
                          style={{ marginTop: 'var(--space-2)' }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {modeId === 'smart' && (
          <div className={styles.settingsRow}>
            <div>
              <SectionHeader title="Режим выборки" />
              <div className={styles.chipRow}>
                <Chip icon="dice" selected={smartRandom} onClick={() => setSmartRandom((v) => !v)}>
                  Случайное
                </Chip>
                <Chip
                  icon="retry"
                  selected={smartUnseen}
                  onClick={() => toggleUnseen(smartUnseen, setSmartUnseen)}
                >
                  Только нерешённые
                </Chip>
              </div>
            </div>

            <div>
              <SectionHeader title="Количество заданий" />
              <div className={styles.chipRow}>
                {smartQuantityOptions.map((option) => (
                  <Chip
                    key={option}
                    selected={option === smartQuantity}
                    onClick={() => setSmartQuantity(option)}
                  >
                    {option}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        )}
      </ContentSwap>

      {startError && (
        <p className="text-body-sm" style={{ color: 'var(--color-error)' }}>
          {startError}
        </p>
      )}

      <div className={styles.startBar}>
        <Button variant="primary" fullWidth loading={starting} onClick={() => void handleStart()}>
          Начать тренировку
        </Button>
      </div>
    </SlideUp>
  );
}
