import { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { computeMistakesSummary, type Mistake } from '../../data/sampleMistakes.js';
import { getMistakes, getSimilarTasks } from '../../lib/api.js';
import { toSampleMistake } from '../../lib/mistakeAdapter.js';
import { useToast } from '../../ui/Toast/ToastProvider.js';
import { formatDateShort } from '../../lib/formatDate.js';
import { Card } from '../../ui/Card/Card.js';
import { Chip } from '../../ui/Chip/Chip.js';
import { Select } from '../../ui/Select/Select.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { DonutChart } from '../../ui/Charts/DonutChart.js';
import { RankedBarList } from '../../ui/Charts/RankedBarList.js';
import { MistakeCardDesktop } from '../../ui/Mistakes/MistakeCardDesktop.js';
import { MistakeNumberGroup } from '../../ui/Mistakes/MistakeNumberGroup.js';
import { FeedbackState } from '../../ui/FeedbackState/FeedbackState.js';
import { FadeIn } from '../../ui/motion/motion.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import styles from './MistakesDesktop.module.css';

type FilterId = 'all' | 'unsolved' | 'byTopic' | 'byDate';

/**
 * Desktop "Мои ошибки" (S1 Block 6, approved design —
 * desktop/08_mistakes.png), now backed by GET /api/v1/mistakes. Every
 * count (list length, "Неразобранные", the donut, "Самые частые
 * ошибки") is computed from the same fetched list, so filtering the
 * list and its sidebar can never drift apart. "Разобрать" opens the
 * real Task → Result flow for that mistake's task, not a static
 * preview.
 */
export function MistakesDesktop() {
  const { navigate } = useNavigation();
  const { show: showToast } = useToast();
  const [subjectId, setSubjectId] = useState('math');
  const [filter, setFilter] = useState<FilterId>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [favorited, setFavorited] = useState<ReadonlySet<string>>(new Set());
  const [mistakes, setMistakes] = useState<readonly Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  // Only one card's "Решить похожее" can be in flight at a time — same
  // pattern as MistakesMobile.
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
  const unsolvedCount = summary.unsolvedCount;

  const groups = useMemo(() => buildGroups(mistakes, filter), [mistakes, filter]);

  function toggleSelect(id: string) {
    setSelected((prev) => toggleInSet(prev, id));
  }

  function toggleFavorite(id: string) {
    setFavorited((prev) => toggleInSet(prev, id));
  }

  function openMistake(mistake: Mistake) {
    navigate({
      screen: 'task',
      subjectId: mistake.subjectId,
      taskNumber: mistake.taskNumber,
      taskId: mistake.taskId,
      returnTo: { screen: 'mistakes' },
    });
  }

  /**
   * "Решить похожее" — same deterministic similarity engine and same
   * `customOrderedTasks` ad-hoc training-list mechanism as
   * MistakesMobile, not a second system. The backend now hard-filters
   * candidates to the exact same taskNumber (see
   * apps/api/src/modules/learning/taskSimilarity/repo.ts), so this
   * never has to re-check the number client-side.
   */
  function solveSimilar(mistake: Mistake) {
    if (solvingSimilarId) return;
    setSolvingSimilarId(mistake.id);
    void getSimilarTasks(mistake.taskId)
      .then((items) => {
        if (items.length === 0) {
          showToast({
            variant: 'info',
            message: 'Похожих заданий этого номера пока нет.',
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

  const subjectOptions = subjects.map((s) => ({ value: s.id, label: s.shortName }));

  return (
    <FadeIn className={styles.page}>
      <BackRow to={{ screen: 'home' }} label="Главная" />
      <div className={styles.headerRow}>
        <div>
          <h1 className="text-h1">Мои ошибки</h1>
          <p className="text-body-sm text-secondary">
            Разбирай ошибки, чтобы больше их не допускать
          </p>
        </div>
        <div className={styles.subjectSelect}>
          <Select options={subjectOptions} value={subjectId} onChange={setSubjectId} />
        </div>
      </div>

      <div className={styles.filterRow}>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
          Все ошибки {mistakes.length}
        </Chip>
        <Chip selected={filter === 'unsolved'} onClick={() => setFilter('unsolved')}>
          Неразобранные {unsolvedCount}
        </Chip>
        <Chip selected={filter === 'byTopic'} onClick={() => setFilter('byTopic')}>
          По темам
        </Chip>
        <Chip selected={filter === 'byDate'} onClick={() => setFilter('byDate')}>
          По дате
        </Chip>
      </div>

      <div className={styles.grid}>
        <div className={styles.list}>
          {loading && <p className="text-body-sm text-secondary">Загрузка ошибок…</p>}
          {!loading && groups.length === 0 && (
            <FeedbackState
              variant="info"
              title="Здесь пока пусто"
              description="Все ошибки в этом фильтре уже разобраны."
            />
          )}
          {groups.map((group) => {
            const cards = group.items.map((m) => (
              <MistakeCardDesktop
                key={m.id}
                mistake={m}
                selected={selected.has(m.id)}
                onToggleSelect={() => toggleSelect(m.id)}
                onReview={() => openMistake(m)}
                onToggleFavorite={() => toggleFavorite(m.id)}
                favorited={favorited.has(m.id)}
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
              <div key={group.label}>
                {group.label && <p className={`text-h3 ${styles.groupLabel}`}>{group.label}</p>}
                <div className={styles.list}>{cards}</div>
              </div>
            );
          })}
        </div>

        <div className={styles.sidebar}>
          <Card>
            <p className="text-h3">Статистика ошибок</p>
            <DonutChart
              ariaLabel="Статистика ошибок по темам"
              segments={summary.topicBreakdown.map((s) => ({
                label: s.topic,
                value: s.count,
                percent: s.percent,
                color: s.color,
              }))}
              centerLabel={
                <>
                  <p className="text-h2">{summary.total}</p>
                  <p className="text-body-sm text-secondary">ошибки</p>
                </>
              }
            />
          </Card>

          <Card>
            <p className="text-h3">Самые частые ошибки</p>
            <RankedBarList
              items={summary.mostFrequent.map((row, i) => ({
                label: row.topic,
                value: row.count,
                color: summary.topicBreakdown[i]?.color ?? 'var(--chart-7)',
              }))}
            />
          </Card>

          <Card>
            <p className={`text-h3 ${styles.recommendationsTitle}`}>
              <Icon name="hint" size={16} />
              Рекомендации
            </p>
            <ul className={styles.tipList}>
              {buildRecommendations(summary, mistakes).map((tip) => (
                <li key={tip} className={styles.tipItem}>
                  <span className={styles.tipDot}>•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}

function toggleInSet(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface MistakeGroup {
  label: string | null;
  taskNumber: number | null;
  items: readonly Mistake[];
}

function buildGroups(items: readonly Mistake[], filter: FilterId): readonly MistakeGroup[] {
  const source = filter === 'unsolved' ? items.filter((m) => m.status === 'unsolved') : items;

  if (filter === 'byTopic') {
    const byTopic = new Map<string, Mistake[]>();
    for (const m of source) {
      (byTopic.get(m.topic) ?? byTopic.set(m.topic, []).get(m.topic)!).push(m);
    }
    return [...byTopic.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([topic, group]) => ({ label: topic, taskNumber: null, items: group }));
  }

  if (filter === 'byDate') {
    const byMonth = new Map<string, Mistake[]>();
    for (const m of source) {
      const label = formatDateShort(m.date).split(' ').slice(1).join(' ');
      (byMonth.get(label) ?? byMonth.set(label, []).get(label)!).push(m);
    }
    return [...byMonth.entries()].map(([label, group]) => ({
      label,
      taskNumber: null,
      items: group,
    }));
  }

  // "Все ошибки" / "Неразобранные" group the real list by task number
  // instead of one long flat feed — the number is the primary visual
  // element (MistakeNumberGroup), expandable per group.
  const byTask = new Map<number, Mistake[]>();
  for (const m of source) {
    (byTask.get(m.taskNumber) ?? byTask.set(m.taskNumber, []).get(m.taskNumber)!).push(m);
  }
  return [...byTask.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, group]) => ({ label: null, taskNumber: number, items: group }));
}

function buildRecommendations(
  summary: ReturnType<typeof computeMistakesSummary>,
  items: readonly Mistake[],
): readonly string[] {
  const topTopic = summary.mostFrequent[0];
  const worstTasks = [
    ...new Set(items.filter((m) => m.topic === topTopic?.topic).map((m) => m.taskNumber)),
  ].slice(0, 2);

  const tips: string[] = [];
  if (topTopic) {
    tips.push(
      `Чаще всего ошибки в теме «${topTopic.topic}». Рекомендуется повторить основные методы.`,
    );
  }
  if (worstTasks.length > 0) {
    tips.push(
      `Обрати внимание на задания ${worstTasks.join(' и ')} — в них допущено больше всего ошибок.`,
    );
  }
  tips.push('Решай похожие задания, чтобы закрепить тему.');
  return tips;
}
