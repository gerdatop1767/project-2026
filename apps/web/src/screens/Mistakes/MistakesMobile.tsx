import { useMemo, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { computeMistakesSummary, type Mistake } from '../../data/sampleMistakes.js';
import { getSimilarTasks } from '../../lib/api.js';
import { useMistakes } from '../../lib/useMistakes.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectHeaderMobile } from '../../ui/SubjectHeader/SubjectHeaderMobile.js';
import { SubjectPickerDialog } from '../../ui/SubjectPicker/SubjectPicker.js';
import { MistakeCardMobile } from '../../ui/Mistakes/MistakeCardMobile.js';
import { MistakeNumberGroup } from '../../ui/Mistakes/MistakeNumberGroup.js';
import { MistakeStats } from '../../ui/Mistakes/MistakeStats.js';
import { FeedbackState } from '../../ui/FeedbackState/FeedbackState.js';
import { useToast } from '../../ui/Toast/ToastProvider.js';
import { ContentSwap, SlideUp } from '../../ui/motion/motion.js';
import styles from './MistakesMobile.module.css';

const viewTabs = [
  { id: 'all', label: 'Все ошибки' },
  { id: 'byTask', label: 'По заданиям' },
  { id: 'byTopic', label: 'По темам' },
];

/**
 * Mobile «Мои ошибки»: the real mistakes of the chosen subject (the header
 * is a real subject picker now — it used to be hard-coded to math, so
 * picking another subject changed nothing). «Начать» runs through the
 * ticked mistakes, or all unsolved ones when none is ticked; every card
 * can be removed from the list with its ×, which the server confirms
 * before the card goes, with a «Вернуть» undo.
 */
export function MistakesMobile() {
  const { navigate, back } = useNavigation();
  const { show: showToast } = useToast();
  const data = useMistakes();
  const { subject, mistakes } = data;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Only one card's "Решить похожее" can be in flight at a time.
  const [solvingSimilarId, setSolvingSimilarId] = useState<string | null>(null);

  const summary = useMemo(() => computeMistakesSummary(mistakes), [mistakes]);
  const unsolved = useMemo(() => mistakes.filter((m) => m.status === 'unsolved'), [mistakes]);
  const groups = useMemo(() => buildGroups(unsolved, view), [unsolved, view]);
  // Ticks belong to the subject on screen: another subject's ids never count.
  const picked = unsolved.filter((m) => selected.has(m.id));

  function selectSubject(id: string) {
    data.selectSubject(id);
    setSelected(new Set());
  }

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

  /** Repeat run: the ticked mistakes, else every unsolved one, in list order. */
  function startRepeat() {
    const run = groups
      .flatMap((g) => g.items)
      .filter((m) => picked.length === 0 || selected.has(m.id));
    const first = run[0];
    if (!first) return;
    navigate({
      screen: 'task',
      subjectId: first.subjectId,
      taskNumber: first.taskNumber,
      taskId: first.taskId,
      customOrderedTasks: run.map((m) => ({ taskId: m.taskId, taskNumber: m.taskNumber })),
      returnTo: { screen: 'mistakes' },
    });
  }

  async function removeMistake(m: Mistake) {
    const ok = await data.dismiss(m.id);
    if (!ok) {
      showToast({ variant: 'error', message: 'Не удалось убрать задание. Попробуй ещё раз.' });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(m.id);
      return next;
    });
    showToast({
      variant: 'success',
      message: `Задание №${m.taskNumber} убрано из ошибок`,
      actionLabel: 'Вернуть',
      durationMs: 6000,
      onAction: () => {
        void data.restore(m.id).then((restored) => {
          if (!restored) showToast({ variant: 'error', message: 'Не удалось вернуть задание.' });
        });
      },
    });
  }

  /**
   * "Решить похожее" — the deterministic similarity engine
   * (`GET /tasks/:taskId/similar`, same task number only). An empty result
   * is real and only shows a toast; it never opens an empty session.
   */
  function solveSimilar(mistake: Mistake) {
    if (solvingSimilarId) return;
    setSolvingSimilarId(mistake.id);
    void getSimilarTasks(mistake.taskId)
      .then((items) => {
        if (items.length === 0) {
          showToast({ variant: 'info', message: 'Похожих заданий этого номера пока нет.' });
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
      <SubjectHeaderMobile
        subject={subject}
        title="Мои ошибки"
        onBack={back}
        onSelectSubject={() => setPickerOpen(true)}
      />
      <SubjectPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={subject.id}
        onSelect={selectSubject}
        subtitle="Покажем ошибки по выбранному предмету"
      />

      <Tabs items={viewTabs} activeId={view} onChange={setView} aria-label="Вид списка ошибок" />

      {data.state === 'error' ? (
        <div className={styles.errorBox} role="alert">
          <FeedbackState
            variant="error"
            title="Не удалось загрузить ошибки"
            description="Проверь соединение и попробуй ещё раз."
          />
          <Button variant="secondary" onClick={data.reload}>
            Повторить
          </Button>
        </div>
      ) : data.state === 'loading' && mistakes.length === 0 ? (
        <p className="text-body-sm text-secondary" role="status">
          Загрузка ошибок…
        </p>
      ) : (
        <ContentSwap key={subject.id}>
          <MistakeStats
            total={summary.total}
            repeatedPercent={summary.repeatedPercent}
            improvementPercent={summary.improvementPercent}
            reviewedAgainCount={summary.reviewedAgainCount}
          />

          <section className={styles.section} aria-labelledby="mistakes-repeat-title">
            <div className={styles.sectionHeaderRow}>
              <h2 id="mistakes-repeat-title" className={`text-h3 ${styles.sectionTitle}`}>
                Повторить ошибки
              </h2>
              {unsolved.length > 0 && (
                <Button variant="primary" className={styles.startButton} onClick={startRepeat}>
                  <Icon name="play" size={16} />
                  {picked.length > 0 ? `Начать (${picked.length})` : 'Начать'}
                </Button>
              )}
            </div>
            {picked.length > 0 && (
              <p className={styles.selectionHint}>
                Выбрано: {picked.length}.{' '}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setSelected(new Set())}
                >
                  Снять выбор
                </button>
              </p>
            )}

            {mistakes.length === 0 ? (
              <FeedbackState
                variant="info"
                title={`По предмету «${subject.shortName}» ошибок нет`}
                description="Когда ответ окажется неверным, задание появится здесь."
              />
            ) : groups.length === 0 ? (
              <FeedbackState
                variant="success"
                title="Все ошибки разобраны!"
                description="Отличная работа — продолжай в том же духе."
              />
            ) : (
              <ContentSwap key={view}>
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
                        onDismiss={() => void removeMistake(m)}
                        dismissing={data.isPending(m.id)}
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
              </ContentSwap>
            )}
          </section>
        </ContentSwap>
      )}

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
