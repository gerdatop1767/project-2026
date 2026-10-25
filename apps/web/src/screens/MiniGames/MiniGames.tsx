import { useEffect, useState } from 'react';
import type { MiniGamesResponse } from '@zybrilka/shared';
import { getMiniGames } from '../../lib/api.js';
import { useNavigation, type Route } from '../../lib/navigation.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './MiniGames.module.css';

/** Where each game's «Играть» leads — one line per new game. */
const gameRoutes: Record<string, Route> = {
  stress: { screen: 'stressGame' },
};

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: MiniGamesResponse };

/** «Мини-игры» — every game from the shared registry, as cards. */
export function MiniGames() {
  const { navigate } = useNavigation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

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
        <ul className={styles.grid}>
          {load.data.games.map((game) => {
            const route = gameRoutes[game.id];
            const share =
              game.progress && game.progress.total > 0
                ? game.progress.learned / game.progress.total
                : null;
            return (
              <li key={game.id}>
                <Card className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.icon} aria-hidden="true">
                      <Icon name="language" size={26} />
                    </span>
                    <div className={styles.cardTitle}>
                      <h2 className="text-h3">{game.title}</h2>
                      <p className={styles.meta}>
                        <span className={styles.subject}>{game.subjectName}</span>
                        {game.egeTask && <span>{game.egeTask}</span>}
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
                  {route && (
                    <Button
                      fullWidth
                      onClick={() => navigate(route)}
                      aria-label={`Играть: ${game.title}`}
                    >
                      <Icon name="play" size={18} /> Играть
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </SlideUp>
  );
}
