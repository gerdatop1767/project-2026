import { useEffect, useId, useMemo, useState } from 'react';
import {
  SMART_TRAINING_MAX,
  SMART_TRAINING_MIN,
  type LearningSessionResponse,
  type SmartDifficulty,
  type SmartSetupResponse,
  type SmartSetupSkill,
  type SmartTrainingMode,
} from '@zybrilka/shared';
import { ApiError, getSmartSetup, startLearningSession } from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import { Button } from '../Button/Button.js';
import { Chip } from '../Chip/Chip.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { SectionHeader } from '../SectionHeader/SectionHeader.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import styles from './SmartTrainingSetup.module.css';

interface ModeInfo {
  readonly id: SmartTrainingMode;
  readonly icon: IconName;
  readonly title: string;
  readonly hint: string;
  /** «Принцип подбора» in the summary. */
  readonly principle: string;
}

export const SMART_MODES: readonly ModeInfo[] = [
  {
    id: 'subject',
    icon: 'grid',
    title: 'Весь предмет',
    hint: 'Задания из разных тем — по одной теме на задание',
    principle:
      'Задания равномерно из всех тем предмета, каждое из другой темы; внутри темы — сначала твои ошибки и новые задания.',
  },
  {
    id: 'topics',
    icon: 'target',
    title: 'Конкретные темы',
    hint: 'Только выбранные тобой темы',
    principle:
      'Задания только из выбранных тем; больше — из тех, где ниже освоение и есть ошибки, новые темы тоже попадут.',
  },
  {
    id: 'problems',
    icon: 'warning',
    title: 'Проблемные темы',
    hint: 'Темы, где у тебя больше всего ошибок',
    principle:
      'Только темы, где по твоей статистике больше всего ошибок, низкая точность или результат падает; 60% — слабые задания, 40% — работа над ошибками.',
  },
  {
    id: 'stats',
    icon: 'progress',
    title: 'По моей статистике',
    hint: 'Ошибки, история решений и уровень освоения',
    principle:
      'Весь предмет по твоей статистике: 45% — слабые темы, 35% — ошибки, 20% — темы, которые давно не повторял.',
  },
  {
    id: 'mixed',
    icon: 'shuffle',
    title: 'Смешанная',
    hint: 'Новое, ошибки, повторение и изученное',
    principle:
      'Смесь: 35% — новые и слабые темы, 25% — ошибки, 25% — повторение, 15% — задания посложнее в изученных темах.',
  },
];

const DIFFICULTIES: readonly { id: SmartDifficulty; label: string; summary: string }[] = [
  { id: 'mixed', label: 'Смешанные', summary: 'по твоему уровню в каждой теме' },
  { id: 'easy', label: 'Лёгкие', summary: 'ближе к лёгким' },
  { id: 'medium', label: 'Средние', summary: 'ближе к средним' },
  { id: 'hard', label: 'Сложные', summary: 'ближе к сложным' },
];

const QUICK_COUNTS = [5, 10, 15, 20];

export const SMART_SUBJECTS = ['math', 'russian'] as const;
const SUBJECT_NAMES: Record<string, string> = { math: 'Математика', russian: 'Русский язык' };

const topicLabel = (s: SmartSetupSkill) =>
  s.examNumber ? `№${s.examNumber} · ${s.title}` : s.title;

function tasksWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} задание`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} задания`;
  return `${n} заданий`;
}

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: SmartSetupResponse };

/**
 * «Умная тренировка» с настройкой (docs/learning/SMART-TRAINING.md): mode,
 * topics, number of tasks, difficulty, then a summary and «Начать
 * тренировку». Every choice goes to the server, which builds the plan on
 * the Learning Engine — nothing here picks tasks.
 */
export function SmartTrainingSetup({
  subjectId,
  onStarted,
}: {
  subjectId: string;
  onStarted: (response: LearningSessionResponse) => boolean;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<SmartTrainingMode>('stats');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [count, setCount] = useState(10);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [difficulty, setDifficulty] = useState<SmartDifficulty>('mixed');
  const [unseenOnly, setUnseenOnly] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ text: string; available?: number } | null>(null);
  const customId = useId();

  // Remounted per subject (the parent keys it), so only a retry reloads.
  useEffect(() => {
    let live = true;
    getSmartSetup(subjectId).then(
      (data) => live && setLoad({ status: 'ready', data }),
      () => live && setLoad({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [subjectId, attempt]);

  const data = load.status === 'ready' ? load.data : null;
  const byKey = useMemo(() => new Map((data?.skills ?? []).map((s) => [s.key, s])), [data]);
  const problemTopics = useMemo(
    () =>
      (data?.problemKeys ?? []).map((k) => byKey.get(k)).filter((s): s is SmartSetupSkill => !!s),
    [data, byKey],
  );

  /** The tasks the chosen scope has (an upper bound for topics sharing tasks; the server checks exactly). */
  const available = !data
    ? null
    : mode === 'topics'
      ? [...picked].reduce((sum, k) => sum + (byKey.get(k)?.availableTasks ?? 0), 0)
      : mode === 'problems'
        ? problemTopics.reduce((sum, s) => sum + s.availableTasks, 0)
        : data.subjectTasks;
  const maxCount = Math.min(SMART_TRAINING_MAX, available ?? SMART_TRAINING_MAX);
  const notEnough = available !== null && available < count;

  const blocker =
    mode === 'topics' && picked.size === 0
      ? 'Выбери хотя бы одну тему.'
      : mode === 'problems' && problemTopics.length === 0
        ? 'Проблемных тем пока нет: реши несколько заданий — и система их найдёт.'
        : available !== null && available < SMART_TRAINING_MIN
          ? `В выбранных темах слишком мало заданий (${available}).`
          : null;

  const draftNumber = Number(customDraft);
  const customError =
    customDraft.trim() === ''
      ? null
      : !Number.isInteger(draftNumber)
        ? 'Введи целое число.'
        : draftNumber < SMART_TRAINING_MIN
          ? `Не меньше ${SMART_TRAINING_MIN}.`
          : draftNumber > maxCount
            ? maxCount < SMART_TRAINING_MAX
              ? `В выбранных темах доступно ${maxCount}.`
              : `Не больше ${SMART_TRAINING_MAX}.`
            : null;

  function toggleTopic(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  }

  async function start(total = count) {
    if (blocker) return;
    setStarting(true);
    setError(null);
    try {
      const response = await startLearningSession({
        subjectId,
        limit: total,
        unseenOnly,
        smart: {
          mode,
          ...(mode === 'topics' ? { skillKeys: [...picked] } : {}),
          difficulty,
        },
      });
      if (!onStarted(response)) setError({ text: 'Не нашлось подходящих заданий.' });
    } catch (e) {
      const body =
        e instanceof ApiError ? (e.body as { error?: string; available?: number }) : null;
      if (body?.error === 'not_enough_tasks') {
        setError({
          text:
            (body.available ?? 0) >= SMART_TRAINING_MIN
              ? `Заданий не хватает: подходят только ${tasksWord(body.available ?? 0)}${unseenOnly ? ' (нерешённых)' : ''}.`
              : 'Подходящих заданий почти нет — выбери другие темы или выключи «Только нерешённые».',
          ...(body.available !== undefined && body.available >= SMART_TRAINING_MIN
            ? { available: body.available }
            : {}),
        });
      } else if (body?.error === 'no_problem_topics') {
        setError({
          text: 'Проблемных тем пока нет: реши несколько заданий — и система их найдёт.',
        });
      } else {
        setError({ text: 'Не удалось начать тренировку — попробуй ещё раз.' });
      }
    } finally {
      setStarting(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Загружаем темы">
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={140} />
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <div className={styles.stack} role="alert">
        <p className="text-body-sm">Не удалось загрузить темы.</p>
        <Button
          variant="secondary"
          onClick={() => {
            setLoad({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  const modeInfo = SMART_MODES.find((m) => m.id === mode)!;
  const topicNames =
    mode === 'topics'
      ? [...picked]
          .map((k) => byKey.get(k))
          .filter(Boolean)
          .map((s) => topicLabel(s!))
      : mode === 'problems'
        ? problemTopics.map(topicLabel)
        : null;
  const realCount = notEnough && available !== null ? available : count;

  return (
    <div className={styles.stack}>
      <section>
        <SectionHeader title="Что тренируем" />
        <div className={styles.modes} role="radiogroup" aria-label="Тип тренировки">
          {SMART_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={clsx(styles.mode, mode === m.id && styles.modeOn)}
              onClick={() => {
                setMode(m.id);
                setError(null);
              }}
            >
              <span className={styles.modeIcon} aria-hidden="true">
                <Icon name={m.icon} size={18} />
              </span>
              <span className={styles.modeText}>
                <span className={styles.modeTitle}>{m.title}</span>
                <span className={styles.modeHint}>{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {mode === 'topics' && (
        <section>
          <div className={styles.rowHead}>
            <SectionHeader title={`Темы · выбрано ${picked.size}`} />
            {picked.size > 0 && (
              <button type="button" className={styles.link} onClick={() => setPicked(new Set())}>
                Сбросить
              </button>
            )}
          </div>
          <ul className={styles.topics}>
            {data!.skills.map((s) => (
              <li key={s.key}>
                <label className={clsx(styles.topic, picked.has(s.key) && styles.topicOn)}>
                  <input
                    type="checkbox"
                    checked={picked.has(s.key)}
                    onChange={() => toggleTopic(s.key)}
                    className={styles.check}
                  />
                  <span className={styles.topicText}>
                    <span className={styles.topicTitle}>{topicLabel(s)}</span>
                    <span className={styles.topicMeta}>
                      {s.mastery === null ? 'ещё не решал' : `освоение ${s.mastery}%`}
                      {' · '}
                      {tasksWord(s.availableTasks)}
                      {s.problem ? ' · есть ошибки' : ''}
                    </span>
                  </span>
                  {s.mastery !== null && (
                    <span className={styles.bar} aria-hidden="true">
                      <span style={{ width: `${s.mastery}%` }} />
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === 'problems' && (
        <section>
          <SectionHeader title="Твои проблемные темы" />
          {problemTopics.length === 0 ? (
            <p className={styles.note}>
              Пока нет тем с заметными проблемами — реши несколько заданий, и система найдёт слабые
              места по твоей статистике.
            </p>
          ) : (
            <ul className={styles.problems}>
              {problemTopics.map((s) => (
                <li key={s.key} className={styles.problem}>
                  <span className={styles.topicTitle}>{topicLabel(s)}</span>
                  <span className={styles.topicMeta}>{s.problem?.reasons.join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <SectionHeader title="Количество заданий" />
        <div className={styles.chips} role="radiogroup" aria-label="Количество заданий">
          {QUICK_COUNTS.map((n) => (
            <Chip
              key={n}
              role="radio"
              aria-checked={count === n && !customOpen}
              selected={count === n && !customOpen}
              onClick={() => {
                setCount(n);
                setCustomOpen(false);
                setError(null);
              }}
            >
              {n}
            </Chip>
          ))}
          <Chip
            role="radio"
            aria-checked={customOpen || !QUICK_COUNTS.includes(count)}
            selected={customOpen || !QUICK_COUNTS.includes(count)}
            icon="edit"
            onClick={() => {
              setCustomDraft(QUICK_COUNTS.includes(count) ? '' : String(count));
              setCustomOpen(true);
            }}
          >
            {!customOpen && !QUICK_COUNTS.includes(count) ? count : 'Своё'}
          </Chip>
        </div>
        {customOpen && (
          <form
            className={styles.custom}
            onSubmit={(e) => {
              e.preventDefault();
              if (customError || customDraft.trim() === '') return;
              setCount(draftNumber);
              setCustomOpen(false);
              setError(null);
            }}
          >
            <label htmlFor={customId} className={styles.customLabel}>
              Своё число ({SMART_TRAINING_MIN}–{maxCount})
            </label>
            <div className={styles.customField}>
              <input
                id={customId}
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={SMART_TRAINING_MIN}
                max={maxCount}
                value={customDraft}
                autoFocus
                aria-invalid={customError !== null}
                onChange={(e) => setCustomDraft(e.target.value)}
              />
              <Button type="submit" disabled={customError !== null || customDraft.trim() === ''}>
                Готово
              </Button>
            </div>
            {customError && (
              <p className={styles.error} role="status">
                {customError}
              </p>
            )}
          </form>
        )}
        {notEnough && !blocker && available !== null && (
          <p className={styles.warn} role="status">
            Доступно до {tasksWord(available)}.{' '}
            <button type="button" className={styles.link} onClick={() => setCount(available)}>
              Выбрать {available}
            </button>
          </p>
        )}
      </section>

      <section>
        <SectionHeader title="Сложность" />
        <div className={styles.chips} role="radiogroup" aria-label="Сложность">
          {DIFFICULTIES.map((d) => (
            <Chip
              key={d.id}
              role="radio"
              aria-checked={difficulty === d.id}
              selected={difficulty === d.id}
              onClick={() => setDifficulty(d.id)}
            >
              {d.label}
            </Chip>
          ))}
        </div>
        <div className={styles.chips}>
          <Chip icon="retry" selected={unseenOnly} onClick={() => setUnseenOnly((v) => !v)}>
            Только нерешённые
          </Chip>
        </div>
      </section>

      <section className={styles.summary} aria-label="Твоя тренировка">
        <h3 className={styles.summaryTitle}>Твоя тренировка</h3>
        <dl className={styles.facts}>
          <div>
            <dt>Предмет</dt>
            <dd>{SUBJECT_NAMES[subjectId] ?? subjectId}</dd>
          </div>
          <div>
            <dt>Режим</dt>
            <dd>{modeInfo.title}</dd>
          </div>
          <div>
            <dt>Темы</dt>
            <dd>
              {topicNames === null
                ? 'все темы предмета'
                : topicNames.length === 0
                  ? '—'
                  : topicNames.length <= 3
                    ? topicNames.join(', ')
                    : `${topicNames.slice(0, 2).join(', ')} и ещё ${topicNames.length - 2}`}
            </dd>
          </div>
          <div>
            <dt>Заданий</dt>
            <dd>
              {realCount}
              {unseenOnly ? ', только нерешённые' : ''}
            </dd>
          </div>
          <div>
            <dt>Сложность</dt>
            <dd>{DIFFICULTIES.find((d) => d.id === difficulty)!.summary}</dd>
          </div>
        </dl>
        <p className={styles.principle}>
          <Icon name="smart" size={16} /> {modeInfo.principle}
        </p>
        {(blocker || error) && (
          <p className={styles.error} role="alert">
            {blocker ?? error!.text}{' '}
            {!blocker && error?.available !== undefined && (
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setCount(error.available!);
                  void start(error.available!);
                }}
              >
                Начать с {error.available}
              </button>
            )}
          </p>
        )}
        <Button
          variant="primary"
          fullWidth
          loading={starting}
          disabled={blocker !== null}
          onClick={() => void start(realCount)}
        >
          Начать тренировку
        </Button>
      </section>
    </div>
  );
}
