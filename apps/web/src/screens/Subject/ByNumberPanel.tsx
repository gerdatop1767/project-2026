import { useState } from 'react';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { availableTaskNumbers } from '../../lib/taskNumbers.js';
import { useTaskCountItems } from '../../lib/useTaskCounts.js';
import {
  resolveSingleNumberSession,
  resolveTaskBatch,
  type TaskPickFilter,
} from '../../lib/startTraining.js';
import type { CollectionListItem } from '@zybrilka/shared';
import { Button } from '../../ui/Button/Button.js';
import { Chip } from '../../ui/Chip/Chip.js';
import { Select } from '../../ui/Select/Select.js';
import { SectionHeader } from '../../ui/SectionHeader/SectionHeader.js';
import { Card } from '../../ui/Card/Card.js';
import styles from './ByNumberPanel.module.css';

interface NumberSelection {
  /** "Ignore the selected Сборник, draw from the whole bank" — see
   * `TaskPickFilter`'s doc comment on why this (not a sequential vs
   * random distinction the backend has no concept of) is what 🎲
   * really toggles. */
  random: boolean;
  unseen: boolean;
}

export interface ByNumberPanelProps {
  subjectId: string;
  /** The subject page's already-loaded collections (one request, shared
   * with Темы/Варианты — never fetched a second time here). */
  collections: readonly CollectionListItem[];
  /** Pre-selects "Сборник". */
  collectionSlug?: string;
  /** Pre-selects this one number on entry (e.g. a task's "К списку
   * заданий №N") — with both flags off, exactly as if the chip had been
   * tapped; never starts training by itself. Out of range → ignored. */
  initialTaskNumber?: number;
  /** Where the started session's Back returns — the subject page, in
   * this mode, with the chosen Сборник. */
  returnTo: (collectionSlug: string | undefined) => Route;
}

/**
 * "По номерам" — one of the Subject page's modes, alongside Темы,
 * Варианты and Избранное (it used to be a separate overlay screen with
 * its own back row and subject picker, which felt like a nested window
 * and sent Back through an extra stop). A user picks one or more task
 * numbers and, independently per number, 🎲 Случайное / 🔄 Только
 * нерешённые — both can be on at once — optionally shuffles the solving
 * order, then starts. Reuses the same `resolveTaskBatch` /
 * `resolveSingleNumberSession` task selection as the rest of the app.
 */
export function ByNumberPanel({
  subjectId,
  collections,
  collectionSlug,
  initialTaskNumber,
  returnTo,
}: ByNumberPanelProps) {
  const { navigate } = useNavigation();
  const { requireAccount } = useAccountGate();
  const [selectedCollectionSlug, setSelectedCollectionSlug] = useState<string | null>(
    collectionSlug ?? null,
  );
  const countItems = useTaskCountItems();
  // The numbers this Сборник (or «Все источники») really has, from the
  // database — ЕГЭ 2027 Ященко: 1–20, the 2026 format: 1–19.
  const numbers = availableTaskNumbers({
    subjectId,
    collection: collections.find((c) => c.collection.slug === selectedCollectionSlug) ?? null,
    poolNumbers: countItems?.[subjectId]?.taskNumbers ?? null,
  });
  const [selection, setSelection] = useState<Record<number, NumberSelection>>(() => {
    if (!initialTaskNumber || initialTaskNumber < 1) return {};
    return { [initialTaskNumber]: { random: false, unseen: false } };
  });
  // A number the chosen source doesn't have is never part of the pick
  // (e.g. №20 chosen in ЕГЭ 2027, then the source switched to 2026).
  const offered = new Set(numbers);
  const activeSelection = Object.fromEntries(
    Object.entries(selection).filter(([number]) => offered.has(Number(number))),
  ) as Record<number, NumberSelection>;
  const [shuffleOrder, setShuffleOrder] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  function thisScreenRoute(): Route {
    return returnTo(selectedCollectionSlug ?? undefined);
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
    // «Только нерешённые» needs to know what you solved — an account.
    if (flag === 'unseen' && !selection[number]?.unseen && !requireAccount('unseen')) return;
    setSelection((prev) =>
      number in prev
        ? { ...prev, [number]: { ...prev[number]!, [flag]: !prev[number]![flag] } }
        : prev,
    );
  }

  async function handleStart() {
    setStartError(null);
    const picked = Object.keys(activeSelection)
      .map(Number)
      .sort((a, b) => a - b);
    if (picked.length === 0) {
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
      if (picked.length === 1) {
        const number = picked[0]!;
        const filter: TaskPickFilter = {
          subject: subjectId,
          taskNumber: number,
          collection: selectedCollectionSlug ?? undefined,
          random: activeSelection[number]!.random,
          unseen: activeSelection[number]!.unseen,
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

      const filters: TaskPickFilter[] = picked.map((n) => ({
        subject: subjectId,
        taskNumber: n,
        collection: selectedCollectionSlug ?? undefined,
        random: activeSelection[n]!.random,
        unseen: activeSelection[n]!.unseen,
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

  const sortedSelected = Object.keys(activeSelection)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <Card className={styles.stack}>
      <div>
        <p className="text-h3">Задания по номерам</p>
        <p className="text-body-sm text-secondary">
          Выбери один или несколько номеров — для каждого можно включить своё сочетание режимов.
        </p>
      </div>

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
          {numbers.map((number) => (
            <Chip
              key={number}
              selected={number in activeSelection}
              onClick={() => toggleNumber(number)}
            >
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
              const flags = activeSelection[number]!;
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
    </Card>
  );
}
