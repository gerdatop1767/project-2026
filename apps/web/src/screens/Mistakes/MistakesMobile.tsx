import { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { computeMistakesSummary, type Mistake } from '../../data/sampleMistakes.js';
import { getMistakes, getSimilarTasks } from '../../lib/api.js';
import { toSampleMistake } from '../../lib/mistakeAdapter.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectHeaderMobile } from '../../ui/SubjectHeader/SubjectHeaderMobile.js';
import { StatTile } from '../../ui/Statistics/StatTile.js';
import { MistakeCardMobile } from '../../ui/Mistakes/MistakeCardMobile.js';
import { MistakeNumberGroup } from '../../ui/Mistakes/MistakeNumberGroup.js';
import { FeedbackState } from '../../ui/FeedbackState/FeedbackState.js';
import { useToast } from '../../ui/Toast/ToastProvider.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './MistakesMobile.module.css';

const viewTabs = [
  { id: 'all', label: 'Все ошибки' },
  { id: 'byTask', label: 'По заданиям' },
  { id: 'byTopic', label: 'По темам' },
];

/**
 * Mobile "Мои ошибки" (S1 Block 6, approved design —
 * mobile/08_mistakes.png): the unsolved-mistakes repeat list, driven
 * by the same `mistakes` seed and summary the desktop screen uses.
 * Selecting mistakes and tapping "Начать" opens the real Task screen
 * for the first selected item — a genuine repeat-training entry
 * point, not a decorative button.
 */
export function MistakesMobile() {
  const { navigate, back } = useNavigation();
  const { show: showToast } = useToast();
  const subject = subjects.find((s) => s.id === 'math') ?? subjects[0]!;
  const [view, setView] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mistakes, setMistakes] = useState<readonly Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  // Only one card's "Решить похожее" can be in flight at a time — the
  // button's own `loading`/disabled state (via Button) is the double-
  // tap guard, this id is just which card to show it on.
  const [solvingSimilarId, setSolvingSimilarId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMistakes()
      .then((items) => {
        if (cancelled) return;
        setMistakes(items.map(toSampleMistake));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => computeMistakesSummary(mistakes), [mistakes]);
  const unsolved = useMemo(() => mistakes.filter((m) => m.status === 'unsolved'), [mistakes]);
  const groups = useMemo(() => buildGroups(unsolved, view), [unsolved, view]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openMistake(m: Mistake) {
    navigate({
      screen: 'task',
      subjectId: m.subjectId,
      taskNumber: m.taskNumber,
      taskId: m.taskId,
      returnTo: { screen: 'mistakes' },
    });
  }

  function startRepeat() {
    const firstId = [...selected][0];
    const target = unsolved.find((m) => m.id === firstId) ?? unsolved[0];
    if (target) openMistake(target);
  }

  /**
   * "Решить похожее" — the existing deterministic Phase 6 similarity
   * engine (`GET /tasks/:taskId/similar`), never a new AI/ML system.
   * The backend hard-filters candidates to the SAME taskNumber as the
   * mistake before scoring (see
   * apps/api/src/modules/learning/taskSimilarity/repo.ts) — a mistake
   * in №5 only ever surfaces other №5 tasks, never a different number
   * that merely scores well on skills/topic. On a real candidate list,
   * this is the exact same `customOrderedTasks` ad-hoc training-list
   * mechanism startCustomVariant/Training's "По номерам" already use —
   * not a second parallel session system. An empty result is real
   * (small catalog today, or genuinely no other task of this exact
   * number yet) and must never silently open an empty/fake session or
   * substitute a different number — only a toast telling the user why.
   */
  function solveSimilar(mistake: Mistake) {
    if (solvingSimilarId) return; // one in-flight request at a time
    setSolvingSimilarId(mistake.id);
    void getSimilarTasks(mistake.taskId)
      .then((items) => {
        if (items.length === 0) {
          showToast({
            variant: 'info',
            message:
              'Похожих заданий этого номера пока нет.',
          });
          return;
        }
        const first = items[0]!;
        navigate({
          screen: 'task',
          subjectId: mistake.subjectId,
          taskNumber: first.taskNumber,
          taskId: first.taskId,
          customOrderedTasks: items.map((i) => ({ taskId: i.taskId, taskNumber: i.taskNumber })),
          returnTo: { screen: 'mistakes' },
        });
      })
      .catch(() => {
        showToast({ variant: 'error', message: 'Не удалось подобрать похожие задания.' });
      })
      .finally(() => setSolvingSimilarId(null));
  }

  return (
    <SlideUp className={styles.stack}>
      <SubjectHeaderMobile subject={subject} title="Мои ошибки" onBack={back} />

      <Tabs items={viewTabs} activeId={view} onChange={setView} aria-label="Вид списка ошибок" />

      <div className={styles.statsGrid}>
        <StatTile
          className={styles.statTile}
          icon="variant"
          iconColor="var(--color-accent-primary-end)"
          label="всего ошибок"
          value={summary.total}
        />
        <StatTile
          className={styles.statTile}
          icon="target"
          iconColor="var(--color-accent-secondary)"
          label="повторяются"
          value={summary.repeatedPercent}
          suffix="%"
        />
        <StatTile
          className={styles.statTile}
          icon="xp"
          iconColor="var(--color-success)"
          label="улучшение"
          value={summary.improvementPercent}
          suffix="%"
        />
        <StatTile
          className={styles.statTile}
          icon="calendar"
          iconColor="var(--color-warning)"
          label="решено повторно"
          value={summary.reviewedAgainCount}
        />
      </div>

      <div>
        <div className={styles.sectionHeaderRow}>
          <p className="text-h3">Повторить ошибки</p>
          <div className={styles.sectionActions}>
            <button
              type="button"
              className={styles.selectButton}
              aria-pressed={selectMode}
              onClick={() => setSelectMode((v) => !v)}
            >
              <Icon name="checklist" size={16} /> Выбрать
            </button>
            <Button
              variant="primary"
              disabled={selectMode && selected.size === 0}
              onClick={startRepeat}
            >
              <Icon name="play" size={16} /> Начать
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-body-sm text-secondary">Загрузка ошибок…</p>
        ) : groups.length === 0 ? (
          <FeedbackState
            variant="success"
            title="Все ошибки разобраны!"
            description="Отличная работа — продолжай в том же духе."
          />
        ) : (
          <div className={styles.list}>
            {groups.map((group) => {
              const cards = group.items.map((m) => (
                <MistakeCardMobile
                  key={m.id}
                  mistake={m}
                  selected={selected.has(m.id)}
                  onToggleSelect={() => toggleSelect(m.id)}
                  onRetry={() => openMistake(m)}
                  onOpen={() => openMistake(m)}
                  onSolveSimilar={() => solveSimilar(m)}
                  solvingSimilar={solvingSimilarId === m.id}
                />
              ));
              if (group.taskNumber !== null) {
                return (
                  <MistakeNumberGroup
                    key={group.taskNumber}
                    taskNumber={group.taskNumber}
                    count={group.items.length}
                  >
                    {cards}
                  </MistakeNumberGroup>
                );
              }
              return (
                <div key={group.label ?? 'all'}>
                  {group.label && (
                    <p className={`text-body-sm text-secondary ${styles.groupLabel}`}>
                      {group.label}
                    </p>
                  )}
                  <div className={styles.list}>{cards}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.analysisButton}
        onClick={() => navigate({ screen: 'statistics' })}
      >
        <Icon name="progress" size={20} />
        <span className={styles.analysisLabel}>Анализ ошибок</span>
        <Icon name="chevronRight" size={18} />
      </button>
    </SlideUp>
  );
}

interface MistakeGroup {
  label: string | null;
  taskNumber: number | null;
  items: readonly Mistake[];
}

function byTaskNumberGroups(items: readonly Mistake[]): readonly MistakeGroup[] {
  const byTask = new Map<number, Mistake[]>();
  for (const m of items) {
    (byTask.get(m.taskNumber) ?? byTask.set(m.taskNumber, []).get(m.taskNumber)!).push(m);
  }
  return [...byTask.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, group]) => ({ label: null, taskNumber: number, items: group }));
}

function buildGroups(items: readonly Mistake[], view: string): readonly MistakeGroup[] {
  if (view === 'byTopic') {
    const byTopic = new Map<string, Mistake[]>();
    for (const m of items) {
      (byTopic.get(m.topic) ?? byTopic.set(m.topic, []).get(m.topic)!).push(m);
    }
    return [...byTopic.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([topic, group]) => ({ label: topic, taskNumber: null, items: group }));
  }
  // "Все ошибки" and "По заданиям" both group the real list by task
  // number — a long flat feed is no longer the default, the number is
  // the primary visual element (MistakeNumberGroup), expandable/
  // collapsible per group.
  return byTaskNumberGroups(items);
}
