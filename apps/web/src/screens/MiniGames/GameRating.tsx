import { useEffect, useState } from 'react';
import type {
  MiniGameRatingEntry,
  MiniGameRatingKind,
  MiniGameRatingResponse,
} from '@zybrilka/shared';
import { getMiniGameRating } from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import { GeneratedAvatar } from '../../ui/Leaderboard/GeneratedAvatar.js';
import { ProfileAvatar } from '../../ui/ProfileAvatar/ProfileAvatar.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SkeletonList } from '../../ui/Skeleton/Skeleton.js';
import styles from './GameRating.module.css';

const KINDS: readonly { id: MiniGameRatingKind; label: string; hint: string }[] = [
  { id: 'best', label: 'Лучший результат', hint: 'Больше всего очков за одну игру' },
  { id: 'total', label: 'Всего очков', hint: 'Очки всех завершённых игр' },
];

const num = new Intl.NumberFormat('ru-RU');
const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

/** 1 игра, 2 игры, 5 игр, 11 игр, 21 игра. */
export function gamesWord(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'игра';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'игры';
  return 'игр';
}

function Avatar({ entry }: { entry: MiniGameRatingEntry }) {
  const fallback = (
    <GeneratedAvatar hue={entry.avatarHue} variant={entry.avatarVariant} size={32} />
  );
  if (!entry.avatarUrl) return fallback;
  return (
    <span className={styles.avatar}>
      <ProfileAvatar src={entry.avatarUrl} fallback={fallback} />
    </span>
  );
}

function Row({ entry, kind }: { entry: MiniGameRatingEntry; kind: MiniGameRatingKind }) {
  return (
    <li className={clsx(styles.row, entry.isMe && styles.me)} data-rank={entry.rank}>
      <span className={styles.rank}>{entry.rank}</span>
      <Avatar entry={entry} />
      <span className={styles.who}>
        <span className={styles.name}>
          {entry.name}
          {entry.isMe && <span className={styles.meBadge}>ты</span>}
        </span>
        <span className={styles.detail}>
          {kind === 'best'
            ? `верно ${entry.bestCorrect} из ${entry.bestQuestions} · ${entry.bestAccuracyPercent}% · ${date.format(new Date(entry.bestAt))}`
            : `${entry.rounds} ${gamesWord(entry.rounds)}`}
        </span>
      </span>
      <span className={styles.points}>
        {num.format(entry.points)}
        <span className={styles.unit}> очк.</span>
      </span>
    </li>
  );
}

/**
 * A game's own rating (docs/MINI_GAMES.md § Рейтинги), all time — no day,
 * week or month: «Лучший результат» (one finished game) and «Всего очков»
 * (every finished game), never mixed with other games.
 */
export function GameRating({ gameId }: { gameId: string }) {
  const [kind, setKind] = useState<MiniGameRatingKind>('best');
  const [load, setLoad] = useState<{
    key: string;
    data: MiniGameRatingResponse | null;
  } | null>(null);
  const key = `${gameId}:${kind}`;

  useEffect(() => {
    let live = true;
    getMiniGameRating(gameId, kind).then(
      (data) => live && setLoad({ key, data }),
      () => live && setLoad({ key, data: null }),
    );
    return () => {
      live = false;
    };
  }, [gameId, kind, key]);

  const data = load?.key === key ? load.data : undefined;
  const meListed = data?.entries.some((e) => e.isMe) ?? false;

  return (
    <section className={styles.card} aria-labelledby={`${gameId}-rating`}>
      <div className={styles.head}>
        <h2 id={`${gameId}-rating`} className={styles.title}>
          <Icon name="crown" size={18} /> Рейтинг игры
        </h2>
        <div className={styles.switch} role="tablist" aria-label="Какой рейтинг">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={kind === k.id}
              className={clsx(styles.tab, kind === k.id && styles.tabOn)}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.hint}>{KINDS.find((k) => k.id === kind)!.hint} · за всё время</p>

      {data === undefined && <SkeletonList rows={3} />}
      {data === null && <p className={styles.hint}>Не удалось загрузить рейтинг.</p>}
      {data && data.entries.length === 0 && (
        <p className={styles.empty}>
          Пока никто не завершил ни одной игры. Заверши раунд — и первое место твоё.
        </p>
      )}
      {data && data.entries.length > 0 && (
        <ol className={styles.list} aria-label={KINDS.find((k) => k.id === kind)!.label}>
          {data.entries.map((e) => (
            <Row key={`${e.rank}-${e.name}-${e.bestAt}`} entry={e} kind={kind} />
          ))}
        </ol>
      )}
      {data?.me && !meListed && (
        <ol className={clsx(styles.list, styles.mine)} aria-label="Твоё место">
          <Row entry={data.me} kind={kind} />
        </ol>
      )}
      {data && !data.me && data.entries.length > 0 && (
        <p className={styles.hint}>Заверши игру, чтобы попасть в рейтинг.</p>
      )}
      {data && data.players > data.entries.length && (
        <p className={styles.hint}>Всего в рейтинге: {num.format(data.players)}</p>
      )}
    </section>
  );
}
