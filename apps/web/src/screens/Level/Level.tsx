import { useCallback, useEffect, useState } from 'react';
import type { XpHistoryItem } from '@zybrilka/shared';
import { getXpHistory } from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import { formatDateShort } from '../../lib/formatDate.js';
import {
  LEVEL_RANKS,
  levelRankFor,
  levelRankRange,
  levelRankStyle,
  nextLevelRank,
} from '../../lib/levelRanks.js';
import { useNavigation } from '../../lib/navigation.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { LevelEmblem } from '../../ui/LevelEmblem/LevelEmblem.js';
import { ProgressBar } from '../../ui/Progress/ProgressBar.js';
import { SkeletonCard, SkeletonList } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './Level.module.css';

const num = new Intl.NumberFormat('ru-RU');

const kindLabel: Record<XpHistoryItem['kind'], string> = {
  task_first_solve: 'Верное решение',
  task_review: 'Повторение',
};

type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: XpHistoryItem[]; nextCursor: string | null; loadingMore: boolean };

/**
 * «Уровень» — one responsive page for phone, tablet and desktop. The level
 * numbers come from the same provider as the header chip (one
 * `GET /progress/xp`), so the two can never disagree; the page asks it to
 * refresh on open. Nothing here computes a level — the server does
 * (docs/XP.md).
 */
export function Level() {
  const { back } = useNavigation();
  const { xp, xpFailed, refreshStreak } = useStreakContext();
  const [history, setHistory] = useState<HistoryState>({ status: 'loading' });

  const fetchHistory = useCallback(() => {
    getXpHistory()
      .then((page) =>
        setHistory({
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
        }),
      )
      .catch(() => setHistory({ status: 'error' }));
  }, []);

  // Initial state is already "loading": the effect only starts requests.
  useEffect(() => {
    // Fresh numbers on open — into the shared provider the header reads.
    refreshStreak();
    fetchHistory();
  }, [refreshStreak, fetchHistory]);

  function retryHistory() {
    setHistory({ status: 'loading' });
    fetchHistory();
  }

  function loadMore() {
    if (history.status !== 'ready' || !history.nextCursor || history.loadingMore) return;
    const cursor = history.nextCursor;
    setHistory({ ...history, loadingMore: true });
    getXpHistory(cursor)
      .then((page) =>
        setHistory((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                items: [...current.items, ...page.items],
                nextCursor: page.nextCursor,
                loadingMore: false,
              }
            : current,
        ),
      )
      .catch(() =>
        setHistory((current) =>
          current.status === 'ready' ? { ...current, loadingMore: false } : current,
        ),
      );
  }

  return (
    <SlideUp className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} aria-label="Назад" onClick={back}>
          <Icon name="back" size={20} />
        </button>
        <h1 className={`text-h2 ${styles.title}`}>Уровень</h1>
      </div>

      {xp === null && xpFailed && (
        <div className={styles.card} role="alert">
          <p className="text-body">Не удалось загрузить уровень.</p>
          <Button variant="secondary" onClick={refreshStreak}>
            Повторить
          </Button>
        </div>
      )}
      {xp === null && !xpFailed && <SkeletonCard height={180} />}

      {xp !== null && (
        <section
          className={styles.hero}
          aria-labelledby="level-current"
          data-rank={levelRankFor(xp.level).id}
          style={levelRankStyle(levelRankFor(xp.level))}
        >
          <div className={styles.heroTop}>
            <LevelEmblem
              rank={levelRankFor(xp.level)}
              level={xp.level}
              size={96}
              animated
              priority
            />
            <div className={styles.heroText}>
              <p className={styles.rankName}>
                Ранг «{levelRankFor(xp.level).name}»
                <span className={styles.rankOf}>
                  {levelRankFor(xp.level).index + 1} из {LEVEL_RANKS.length}
                </span>
              </p>
              <p id="level-current" className={styles.levelValue}>
                Уровень {xp.level}
              </p>
              <p className={styles.muted}>Всего опыта: {num.format(xp.totalXp)} XP</p>
            </div>
          </div>

          {xp.isMaxLevel ? (
            <div className={styles.maxBox}>
              <p className={styles.strong}>Это максимальный уровень</p>
              <p className={styles.muted}>Дальше уровни не растут, но опыт продолжает копиться.</p>
            </div>
          ) : (
            <>
              <ProgressBar
                large
                value={xp.progress * 100}
                label={`Прогресс до уровня ${xp.level + 1}`}
              />
              <div className={styles.progressRow}>
                <span>
                  {num.format(xp.xpIntoLevel)} / {num.format(xp.xpForNextLevel ?? 0)} XP
                </span>
                <span>Уровень {xp.level + 1}</span>
              </div>
              <p className={styles.remaining}>
                До уровня {xp.level + 1} осталось{' '}
                <strong>{num.format(xp.xpToNextLevel ?? 0)} XP</strong>
              </p>
            </>
          )}
          <NextRank level={xp.level} />
        </section>
      )}

      {xp !== null && <RankLadder level={xp.level} />}

      <section className={styles.card} aria-labelledby="level-how">
        <h2 id="level-how" className={styles.sectionTitle}>
          Как получать опыт
        </h2>
        <ul className={styles.rules}>
          <li>Опыт даётся за верно решённое задание — один раз за каждое задание.</li>
          <li>Чем сложнее задание, тем больше опыта.</li>
          <li>
            Если вернуться к решённому заданию через неделю и снова решить верно — немного опыта за
            повторение.
          </li>
          <li>За неверный ответ, открытие задания или просмотр разбора опыт не начисляется.</li>
        </ul>
      </section>

      <section className={styles.card} aria-labelledby="level-history">
        <h2 id="level-history" className={styles.sectionTitle}>
          История опыта
        </h2>
        {history.status === 'loading' && <SkeletonList rows={4} />}
        {history.status === 'error' && (
          <div className={styles.inlineError} role="alert">
            <p className="text-body-sm">Не удалось загрузить историю.</p>
            <Button variant="secondary" onClick={retryHistory}>
              Повторить
            </Button>
          </div>
        )}
        {history.status === 'ready' && history.items.length === 0 && (
          <p className={styles.muted}>
            Пока пусто. Реши первое задание верно — и здесь появится первая запись.
          </p>
        )}
        {history.status === 'ready' && history.items.length > 0 && (
          <>
            <ul className={styles.historyList}>
              {history.items.map((item) => (
                <li key={item.id} className={styles.historyItem}>
                  <div className={styles.historyText}>
                    <span className={styles.strong}>{kindLabel[item.kind]}</span>
                    <span className={styles.muted}>
                      {item.task
                        ? `${item.task.subjectName} · задание ${item.task.taskNumber}`
                        : 'Задание удалено'}
                      {' · '}
                      {formatDateShort(item.createdAt)}
                    </span>
                  </div>
                  <span className={styles.amount}>+{num.format(item.amount)} XP</span>
                </li>
              ))}
            </ul>
            {history.nextCursor && (
              <Button variant="secondary" loading={history.loadingMore} onClick={loadMore}>
                Показать ещё
              </Button>
            )}
          </>
        )}
      </section>
    </SlideUp>
  );
}

/** «Следующий ранг — «Мастер» с уровня 15», or the top rank's note. */
function NextRank({ level }: { level: number }) {
  const next = nextLevelRank(levelRankFor(level));
  if (!next) {
    return <p className={styles.nextRank}>Это высший ранг — так держать!</p>;
  }
  return (
    <p className={styles.nextRank}>
      <LevelEmblem rank={next} size={24} />
      <span>
        Следующий ранг — <strong>«{next.name}»</strong> с уровня {next.minLevel}
      </span>
    </p>
  );
}

/** Every rank, in order: reached ones in colour, the current one marked,
 * the rest greyed out with the level that unlocks them. */
function RankLadder({ level }: { level: number }) {
  const current = levelRankFor(level);
  return (
    <section className={styles.card} aria-labelledby="level-ranks">
      <h2 id="level-ranks" className={styles.sectionTitle}>
        Ранги
      </h2>
      <ol className={styles.ladder}>
        {LEVEL_RANKS.map((rank) => {
          const reached = rank.index <= current.index;
          const isCurrent = rank.index === current.index;
          return (
            <li
              key={rank.id}
              className={clsx(styles.ladderItem, isCurrent && styles.ladderCurrent)}
              style={levelRankStyle(rank)}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <LevelEmblem rank={rank} size={40} locked={!reached} />
              <span className={styles.ladderText}>
                <span className={styles.strong}>{rank.name}</span>
                <span className={styles.muted}>Уровни {levelRankRange(rank)}</span>
                {isCurrent && <span className={styles.ladderYou}>Ваш ранг</span>}
              </span>
              <span className={styles.ladderState}>
                {!isCurrent &&
                  (reached ? <Icon name="check" size={18} /> : <Icon name="lock" size={16} />)}
                {!reached && (
                  <span className={styles.srOnly}>Откроется с уровня {rank.minLevel}</span>
                )}
                {reached && !isCurrent && <span className={styles.srOnly}>Пройден</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
