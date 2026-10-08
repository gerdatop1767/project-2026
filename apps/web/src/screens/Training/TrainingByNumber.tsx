import { useEffect, useState } from 'react';
import { getRouteLabel, useNavigation, type Route } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { getSubjectContent } from '../../data/subjectContent.js';
import { listCollections } from '../../lib/api.js';
import {
  resolveSingleNumberSession,
  resolveTaskBatch,
  type TaskPickFilter,
} from '../../lib/startTraining.js';
import type { CollectionListItem } from '@zybrilka/shared';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Chip } from '../../ui/Chip/Chip.js';
import { Select } from '../../ui/Select/Select.js';
import { SectionHeader } from '../../ui/SectionHeader/SectionHeader.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './TrainingByNumber.module.css';

interface NumberSelection {
  /** "Ignore the selected Сборник, draw from the whole bank" — see
   * `TaskPickFilter`'s doc comment on why this (not a sequential vs
   * random distinction the backend has no concept of) is what 🎲
   * really toggles. */
  random: boolean;
  unseen: boolean;
}

const subjectSelectOptions = subjects.map((subject) => ({
  value: subject.id,
  label: subject.name,
}));

function backLabelFor(route: Route | undefined): string {
  if (!route) return 'Тренировка';
  if (route.screen === 'subject') {
    return subjects.find((s) => s.id === route.subjectId)?.shortName ?? 'Предмет';
  }
  return getRouteLabel(route);
}

export interface TrainingByNumberProps {
  /** Pre-selects the subject (e.g. arriving from Subject's own
   * "Задания по номерам" tab) — absent falls back to "Математика",
   * same default Training/TrainingByNumber always had. */
  subjectId?: string;
  /** Pre-selects "Сборник" — see SubjectDesktopProps for the same
   * pattern. */
  collectionSlug?: string;
  /** Where Back/the resulting training session's Back arrow should
   * return to — Training's mode grid or Subject's own tab, whichever
   * actually opened this screen (audit: Back routing fix). Absent
   * falls back to "Тренировка", the screen's own previous default. */
  from?: Route;
  /** Pre-selects this one number on entry (e.g. arriving from a task's
   * "Другие задания №N" → "К списку заданий №N") — applied once, at
   * mount, with both flags off (the same default `toggleNumber` gives
   * any freshly-picked number); the user can add/remove numbers
   * afterward exactly as if they'd clicked the chip themselves. Never
   * starts training automatically. An out-of-range number for the
   * resolved subject is silently ignored. */
  initialTaskNumber?: number;
}

/**
 * Тренировка → По номерам: its own real screen, not a cramped block
 * inside Training — a user picks one or more task numbers (№1…№19)
 * and, independently per number, 🎲 Случайное / 🔄 Только нерешённые —
 * both can be on at once, they are not mutually exclusive — optionally
 * shuffles the solving order, then starts. Reuses exactly the same
 * `getRandomTask`/real `unseen` filter and `customOrderedTasks`
 * task-navigation mechanism Training/Subject's "Собери вариант"
 * already use via the shared `resolveTaskBatch` — no second
 * task-selection mechanism. One shared component for desktop/mobile
 * (same business logic, the layout itself is already responsive).
 */
export function TrainingByNumber({
  subjectId,
  collectionSlug,
  from,
  initialTaskNumber,
}: TrainingByNumberProps) {
  const { navigate } = useNavigation();
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjectId ?? 'math');
  const [collections, setCollections] = useState<readonly CollectionListItem[]>([]);
  const [selectedCollectionSlug, setSelectedCollectionSlug] = useState<string | null>(
    collectionSlug ?? null,
  );
  // Applied once, at mount — same shape toggleNumber gives any
  // freshly-picked chip (both flags off), so the user can immediately
  // add/remove/adjust it exactly as if they'd clicked it themselves.
  // Out-of-range for the resolved subject → silently ignored, matching
  // selectSubject's own existing out-of-range rule below.
  const [selection, setSelection] = useState<Record<number, NumberSelection>>(() => {
    if (!initialTaskNumber) return {};
    const max = getSubjectContent(subjectId ?? 'math').taskNumberCount;
    if (initialTaskNumber < 1 || initialTaskNumber > max) return {};
    return { [initialTaskNumber]: { random: false, unseen: false } };
  });
  const [shuffleOrder, setShuffleOrder] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listCollections()
      .then((items) => {
        if (!cancelled) setCollections(items);
      })
      .catch(() => {
        // "Сборник" simply stays empty/unavailable — по номерам still
        // works without it (draws from the whole bank).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function thisScreenRoute(): Route {
    return {
      screen: 'trainingByNumber',
      subjectId: selectedSubjectId,
      collectionSlug: selectedCollectionSlug ?? undefined,
      from,
    };
  }

  // A number not valid for the newly selected subject (e.g. №19 after
  // switching to a subject with fewer numbers) must not stay silently
  // selected — the chip grid below it won't even render that number.
  function selectSubject(id: string) {
    setSelectedSubjectId(id);
    const max = getSubjectContent(id).taskNumberCount;
    setSelection((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([n]) => Number(n) <= max)),
    );
  }

  function toggleNumber(number: number) {
    setSelection((prev) => {
      if (number in prev) {
        const next = { ...prev };
        delete next[number];
        return next;
      }
      return { ...prev, [number]: { random: false, unseen: false } };
    });
  }

  function toggleFlag(number: number, flag: 'random' | 'unseen') {
    setSelection((prev) =>
      number in prev
        ? { ...prev, [number]: { ...prev[number]!, [flag]: !prev[number]![flag] } }
        : prev,
    );
  }

  async function handleStart() {
    setStartError(null);
    const numbers = Object.keys(selection)
      .map(Number)
      .sort((a, b) => a - b);
    if (numbers.length === 0) {
      setStartError('Выбери хотя бы один номер задания.');
      return;
    }

    setStarting(true);
    try {
      // Exactly one number selected: the real navigation list is every
      // published copy of THIS number across variants/sources (V1#N,
      // V2#N, ...), never a single-item list — see
      // resolveSingleNumberSession's doc comment for why
      // `resolveTaskBatch` (one random task per DISTINCT number) is the
      // wrong tool here.
      if (numbers.length === 1) {
        const number = numbers[0]!;
        const filter: TaskPickFilter = {
          subject: selectedSubjectId,
          taskNumber: number,
          collection: selectedCollectionSlug ?? undefined,
          random: selection[number]!.random,
          unseen: selection[number]!.unseen,
        };
        const result = await resolveSingleNumberSession(filter, { shuffleOrder });
        if ('error' in result) {
          if (result.error.reason === 'no_unseen_tasks') {
            setStartError(
              `Для №${number} больше нет нерешённых заданий. Можно выключить «Только нерешённые» для этого номера.`,
            );
          } else {
            setStartError('Не нашлось подходящих заданий — попробуй другие номера или режимы.');
          }
          return;
        }

        const start = result.tasks.find((t) => t.id === result.startTaskId) ?? result.tasks[0]!;
        navigate({
          screen: 'task',
          subjectId: start.subjectId,
          taskNumber: start.taskNumber,
          taskId: start.id,
          customOrderedTasks: result.tasks.map((t) => ({ taskId: t.id, taskNumber: t.taskNumber })),
          returnTo: thisScreenRoute(),
        });
        return;
      }

      const filters: TaskPickFilter[] = numbers.map((n) => ({
        subject: selectedSubjectId,
        taskNumber: n,
        collection: selectedCollectionSlug ?? undefined,
        random: selection[n]!.random,
        unseen: selection[n]!.unseen,
      }));

      const result = await resolveTaskBatch(filters, { shuffleOrder });
      if ('error' in result) {
        if (result.error.reason === 'no_unseen_tasks') {
          setStartError(
            `Для №${result.error.filter.taskNumber} больше нет нерешённых заданий. Можно выключить «Только нерешённые» для этого номера.`,
          );
        } else {
          setStartError('Не нашлось подходящих заданий — попробуй другие номера или режимы.');
        }
        return;
      }

      const first = result.tasks[0]!;
      navigate({
        screen: 'task',
        subjectId: first.subjectId,
        taskNumber: first.taskNumber,
        taskId: first.id,
        customOrderedTasks: result.tasks.map((t) => ({ taskId: t.id, taskNumber: t.taskNumber })),
        returnTo: thisScreenRoute(),
      });
    } finally {
      setStarting(false);
    }
  }

  const sortedSelected = Object.keys(selection)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <SlideUp className={styles.stack}>
      <BackRow to={from ?? { screen: 'training' }} label={backLabelFor(from)} />
      <h1 className="text-h1">Задания по номерам</h1>
      <p className="text-body-sm text-secondary">
        Выбери один или несколько номеров — для каждого можно включить своё сочетание режимов.
      </p>

      <Select
        label="Предмет"
        options={subjectSelectOptions}
        value={selectedSubjectId}
        onChange={selectSubject}
      />

      {collections.length > 0 && (
        <div>
          <SectionHeader title="Сборник" />
          <Select
            options={collections.map((c) => ({
              value: c.collection.slug,
              label: c.collection.title,
            }))}
            value={selectedCollectionSlug}
            onChange={(slug) =>
              setSelectedCollectionSlug(slug === selectedCollectionSlug ? null : slug)
            }
            placeholder="Все источники"
          />
        </div>
      )}

      <div>
        <SectionHeader title="Номера заданий" />
        <div className={styles.chipRow}>
          {Array.from(
            { length: getSubjectContent(selectedSubjectId).taskNumberCount },
            (_, i) => i + 1,
          ).map((number) => (
            <Chip key={number} selected={number in selection} onClick={() => toggleNumber(number)}>
              №{number}
            </Chip>
          ))}
        </div>
      </div>

      {sortedSelected.length > 0 && (
        <div>
          <SectionHeader title="Режим для каждого номера" />
          <div className={styles.modeList}>
            {sortedSelected.map((number) => {
              const flags = selection[number]!;
              return (
                <div key={number} className={styles.modeRow}>
                  <span className="text-body-sm" style={{ fontWeight: 700 }}>
                    №{number}
                  </span>
                  <div className={styles.chipRow}>
                    <Chip
                      icon="dice"
                      selected={flags.random}
                      onClick={() => toggleFlag(number, 'random')}
                    >
                      Случайное
                    </Chip>
                    <Chip
                      icon="retry"
                      selected={flags.unseen}
                      onClick={() => toggleFlag(number, 'unseen')}
                    >
                      Только нерешённые
                    </Chip>
                  </div>
                </div>
              );
            })}
          </div>

          <Chip
            icon="shuffle"
            selected={shuffleOrder}
            onClick={() => setShuffleOrder((v) => !v)}
            className={styles.shuffleChip}
          >
            Перемешать порядок
          </Chip>
        </div>
      )}

      {startError && (
        <p className="text-body-sm" style={{ color: 'var(--color-error)' }}>
          {startError}
        </p>
      )}

      <Button variant="primary" fullWidth loading={starting} onClick={() => void handleStart()}>
        Начать тренировку
      </Button>
    </SlideUp>
  );
}
