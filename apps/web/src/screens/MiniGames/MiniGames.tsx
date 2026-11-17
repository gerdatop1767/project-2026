import { useEffect, useState } from 'react';
import { QUIZ_TOPICS, type MiniGamesResponse } from '@zybrilka/shared';
import { getMiniGames } from '../../lib/api.js';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { clsx } from '../../lib/clsx.js';
import styles from './MiniGames.module.css';

/** Where a game's «Играть» leads: «Ударения» has its own screen, every
 * quiz game the shared one (`/games/:gameId`). */
const gameRoute = (id: string): Route =>
  id === 'stress' ? { screen: 'stressGame' } : { screen: 'quizGame', gameId: id };

const CATEGORIES = [
  { id: 'russian', label: 'Русский язык' },
  { id: 'math', label: 'Математика' },
] as const;
type Category = (typeof CATEGORIES)[number]['id'];
const CATEGORY_KEY = 'zybrilka.miniGames.category';

function storedCategory(): Category {
  try {
    return window.localStorage.getItem(CATEGORY_KEY) === 'math' ? 'math' : 'russian';
  } catch {
    return 'russian';
  }
}

/** «1 вопрос», «3 вопроса», «5 вопросов». */
export function questionsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const w =
    d === 1 && dd !== 11
      ? 'вопрос'
      : d >= 2 && d <= 4 && (dd < 12 || dd > 14)
        ? 'вопроса'
        : 'вопросов';
  return `${n} ${w}`;
}

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: MiniGamesResponse };

/**
 * «Мини-игры» — every game of the shared registry: one tab per subject
 * (the choice is remembered), inside it the games grouped by topic, each
 * card with its real number of questions and the player's progress.
 */
export function MiniGames() {
  const { navigate } = useNavigation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [category, setCategory] = useState<Category>(storedCategory);
  const choose = (c: Category) => {
    setCategory(c);
    try {
      window.localStorage.setItem(CATEGORY_KEY, c);
    } catch {
      // Not remembered; the tab still switches.
    }
  };

  useEffect(() => {
    let cancelled = false;
    getMiniGames().then(
      (data) => !cancelled && setLoad({ status: 'ready', data }),
      () => !cancelled && setLoad({ status: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SlideUp className={styles.page}>
      <BackRow to={{ screen: 'training' }} label="Задания" />
      <header className={styles.head}>
        <h1 className="text-h1">Мини-игры</h1>
        <p className="text-body-sm text-secondary">
          Короткие игры на то, что проще выучить, чем решить: несколько минут в день.
        </p>
      </header>
      {load.status === 'loading' && <Skeleton height={160} />}
      {load.status === 'error' && (
        <Card role="alert">
          <p className="text-body">Не удалось загрузить игры — попробуй ещё раз.</p>
        </Card>
      )}
      {load.status === 'ready' && (
        <div className={styles.tabs} role="tablist" aria-label="Предмет">
          {CATEGORIES.filter((c) => load.data.games.some((g) => g.subjectId === c.id)).map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={clsx(styles.tab, category === c.id && styles.tabActive)}
              onClick={() => choose(c.id)}
            >
              {c.label}
              <span className={styles.tabCount}>
                {load.data.games.filter((g) => g.subjectId === c.id).length}
              </span>
            </button>
          ))}
        </div>
      )}
      {load.status === 'ready' && (
        <div
          className={styles.topics}
          role="tabpanel"
          aria-label={CATEGORIES.find((c) => c.id === category)!.label}
        >
          {QUIZ_TOPICS.map((topic) => {
            const games = load.data.games.filter(
              (g) => g.subjectId === category && g.topic === topic.id,
            );
            if (games.length === 0) return null;
            return (
              <section
                key={topic.id}
                className={styles.topic}
                aria-labelledby={`topic-${topic.id}`}
              >
                <h2 id={`topic-${topic.id}`} className={styles.topicTitle}>
                  {topic.title}
                </h2>
                <ul className={styles.grid}>
                  {games.map((game) => {
                    const share =
                      game.progress && game.progress.total > 0
                        ? game.progress.learned / game.progress.total
                        : null;
                    return (
                      <li key={game.id}>
                        <Card className={styles.card}>
                          <div className={styles.cardTop}>
                            <span
                              className={clsx(
                                styles.icon,
                                game.subjectId === 'math' && styles.iconMath,
                              )}
                              aria-hidden="true"
                            >
                              <Icon
                                name={game.subjectId === 'math' ? 'calculator' : 'language'}
                                size={26}
                              />
                            </span>
                            <div className={styles.cardTitle}>
                              <h3 className="text-h3">{game.title}</h3>
                              <p className={styles.meta}>
                                {game.egeTask && <span>{game.egeTask}</span>}
                                <span>{questionsWord(game.questionCount)}</span>
                              </p>
                            </div>
                          </div>
                          <p className="text-body-sm text-secondary">{game.description}</p>
                          {game.progress && share !== null && (
                            <div className={styles.progress}>
                              <span className={styles.bar} aria-hidden="true">
                                <span style={{ width: `${Math.round(share * 100)}%` }} />
                              </span>
                              <span className="text-body-sm text-secondary">
                                Выучено {game.progress.learned} из {game.progress.total}
                              </span>
                            </div>
                          )}
                          <Button
                            fullWidth
                            disabled={game.questionCount === 0}
                            onClick={() => navigate(gameRoute(game.id))}
                            aria-label={`Играть: ${game.title}`}
                          >
                            <Icon name="play" size={18} /> Играть
                          </Button>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </SlideUp>
  );
}
