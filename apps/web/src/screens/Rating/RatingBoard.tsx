import { useEffect, useState } from 'react';
import type { LeaderboardEntry, LeaderboardPeriod, LeaderboardResponse } from '@zybrilka/shared';
import { subjects } from '../../data/subjects.js';
import { getLeaderboard } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import { levelRankFor, levelRankStyle, nextLevelRank } from '../../lib/levelRanks.js';
import { useNavigation } from '../../lib/navigation.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Avatar } from '../../ui/Leaderboard/Avatar.js';
import { LevelEmblem } from '../../ui/LevelEmblem/LevelEmblem.js';
import { ProfileAvatar } from '../../ui/ProfileAvatar/ProfileAvatar.js';
import { Select } from '../../ui/Select/Select.js';
import { SkeletonCard, SkeletonList } from '../../ui/Skeleton/Skeleton.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import styles from './RatingBoard.module.css';

const num = new Intl.NumberFormat('ru-RU');

const periodTabs: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'week', label: 'Неделя' },
  { id: 'all', label: 'Всё время' },
];
const periodEyebrow: Record<LeaderboardPeriod, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  all: 'Всё время',
};
const pointsCaption: Record<LeaderboardPeriod, string> = {
  today: 'очков за сегодня',
  week: 'очков за 7 дней',
  all: 'очков за всё время',
};

const ALL = 'all';
const subjectOptions = [
  { value: ALL, label: 'Все предметы' },
  ...subjects.map((s) => ({ value: s.id, label: s.name })),
];

type Result = { key: string } & (
  { status: 'error' } | { status: 'ready'; board: LeaderboardResponse }
);

function participantsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'участника';
  return 'участников';
}

/**
 * «Рейтинг» (docs/LEADERBOARD.md) — one responsive board for phone and
 * desktop: period and subject filters, the top three, the rest of the list
 * and the user's own result. Every number comes from GET /leaderboard;
 * nothing here is sample data. A guest is offered sign-in instead.
 */
export function RatingBoard() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  if (!user) {
    return (
      <section className={styles.guest}>
        <Icon name="achievements" size={32} className={styles.guestIcon} />
        <p className="text-h3">Рейтинг виден после входа</p>
        <p className="text-body-sm text-secondary">
          Войди, чтобы набирать очки за решённые задания и соревноваться с другими.
        </p>
        <Button onClick={() => navigate({ screen: 'login' })}>Войти</Button>
      </section>
    );
  }
  return <Board avatarUrl={user.avatarUrl} />;
}

function Board({ avatarUrl }: { avatarUrl: string | null }) {
  const { navigate } = useNavigation();
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [subject, setSubject] = useState<string>(ALL);
  // Bumped by «Повторить» to ask again for the same filters.
  const [attempt, setAttempt] = useState(0);
  const key = `${period}|${subject}|${attempt}`;
  const [result, setResult] = useState<Result | null>(null);
  // Loading = no answer yet for the current filters; an answer for older
  // filters (fast switching) is never shown for the new ones.
  const state = result && result.key === key ? result : ({ status: 'loading' } as const);

  useEffect(() => {
    let current = true;
    getLeaderboard({ period, subject: subject === ALL ? null : subject })
      .then((board) => {
        if (current) setResult({ key, status: 'ready', board });
      })
      .catch(() => {
        if (current) setResult({ key, status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [key, period, subject]);

  const board = state.status === 'ready' ? state.board : null;
  const podium = board ? board.entries.slice(0, 3) : [];
  const rest = board ? board.entries.slice(3) : [];
  const meListed = board?.entries.some((e) => e.isMe) ?? false;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Рейтинг · {periodEyebrow[period]}</p>
            <h1 className={styles.title}>
              Соревнуйся и <span className={styles.accent}>расти</span>
            </h1>
            <p className="text-body-sm text-secondary">
              Решай задания ЕГЭ, набирай очки и поднимайся в рейтинге
            </p>
          </div>
          <div className={styles.controls}>
            <Tabs
              items={periodTabs}
              activeId={period}
              onChange={(id) => setPeriod(id as LeaderboardPeriod)}
              aria-label="Период рейтинга"
            />
            <Select
              options={subjectOptions}
              value={subject}
              onChange={setSubject}
              sheetTitle="Предмет"
              label="Предмет"
            />
          </div>
        </header>

        {state.status === 'loading' && (
          <div className={styles.loading} aria-busy="true" aria-label="Рейтинг загружается">
            <SkeletonCard height={180} />
            <SkeletonList rows={5} />
          </div>
        )}

        {state.status === 'error' && (
          <div className={styles.message} role="alert">
            <p className="text-body">Не удалось загрузить рейтинг.</p>
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </div>
        )}

        {board && board.entries.length === 0 && (
          <div className={styles.message}>
            <Icon name="achievements" size={28} className={styles.guestIcon} />
            <p className="text-body">
              {period === 'today'
                ? 'Сегодня ещё никто не набрал очков.'
                : 'За этот период ещё никто не набрал очков.'}
            </p>
            <p className="text-body-sm text-secondary">
              Реши задание верно — и первое место будет твоим.
            </p>
            <Button onClick={() => navigate({ screen: 'subjectCatalog' })}>Решать задания</Button>
          </div>
        )}

        {podium.length > 0 && (
          <ol className={styles.podium} aria-label="Тройка лидеров">
            {podium.map((entry, index) => (
              <PodiumCard
                key={`${entry.rank}-${index}`}
                entry={entry}
                place={index + 1}
                avatarUrl={avatarUrl}
              />
            ))}
          </ol>
        )}

        {(rest.length > 0 || (board && !meListed && board.me.rank !== null)) && (
          <div className={styles.table} role="table" aria-label="Рейтинг участников">
            <div className={styles.tableHead} role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Ученик</span>
              <span role="columnheader" className={styles.wideOnly}>
                Решено задач
              </span>
              <span role="columnheader" className={styles.wideOnly}>
                Точность
              </span>
              <span role="columnheader" className={styles.alignEnd}>
                Очки
              </span>
            </div>
            {rest.map((entry, i) => (
              <Row key={`${entry.rank}-${i}`} entry={entry} avatarUrl={avatarUrl} />
            ))}
            {board && !meListed && board.me.rank !== null && (
              <>
                <div className={styles.gap} role="presentation">
                  ···
                </div>
                <Row
                  entry={{
                    rank: board.me.rank,
                    name: 'Ты',
                    level: board.me.level,
                    points: board.me.points,
                    solved: board.me.solved,
                    accuracyPercent: board.me.accuracyPercent,
                    isMe: true,
                    avatarHue: 270,
                  }}
                  avatarUrl={avatarUrl}
                />
              </>
            )}
          </div>
        )}
      </div>

      <aside className={styles.side}>
        {board && <MyResult board={board} />}
        <NextLevel />
      </aside>
    </div>
  );
}

function EntryAvatar({
  entry,
  avatarUrl,
  size,
}: {
  entry: LeaderboardEntry;
  avatarUrl: string | null;
  size: number;
}) {
  const fallback = (
    <Avatar username={entry.name} color={`hsl(${entry.avatarHue} 65% 55%)`} size={size} />
  );
  // Only the user's own photo is ever shown (their own profile).
  if (entry.isMe && avatarUrl) {
    return (
      <span className={styles.ownAvatar} style={{ width: size, height: size }}>
        <ProfileAvatar src={avatarUrl} fallback={fallback} />
      </span>
    );
  }
  return fallback;
}

function LevelPill({ level }: { level: number }) {
  const rank = levelRankFor(level);
  return (
    <span className={styles.levelPill} style={levelRankStyle(rank)} title={`Ранг «${rank.name}»`}>
      Ур. {level}
    </span>
  );
}

/** `place` = position on the podium (1 in the middle, 2 left, 3 right);
 * the medal shows the real rank, which a tie can share (1, 1, 3). */
function PodiumCard({
  entry,
  place,
  avatarUrl,
}: {
  entry: LeaderboardEntry;
  place: number;
  avatarUrl: string | null;
}) {
  return (
    <li
      className={clsx(styles.podiumCard, entry.isMe && styles.isMe)}
      data-place={place}
      aria-label={`${entry.rank} место: ${entry.name}${entry.isMe ? ' (это ты)' : ''}, ${entry.points} очков`}
    >
      <span className={styles.medal} aria-hidden="true">
        {entry.rank}
      </span>
      <span className={styles.podiumAvatar}>
        <EntryAvatar entry={entry} avatarUrl={avatarUrl} size={place === 1 ? 72 : 60} />
      </span>
      <span className={styles.podiumName}>{entry.name}</span>
      <span className={styles.podiumBadges}>
        <LevelPill level={entry.level} />
        {entry.isMe && <span className={styles.meBadge}>Это ты</span>}
      </span>
      <span className={styles.podiumPoints}>
        <Icon name="star" size={18} className={styles.pointsIcon} />
        {num.format(entry.points)}
      </span>
      <span className={styles.podiumStats}>
        <span>
          Решено задач: <strong>{num.format(entry.solved)}</strong>
        </span>
        <span>
          Точность:{' '}
          <strong>{entry.accuracyPercent === null ? '—' : `${entry.accuracyPercent}%`}</strong>
        </span>
      </span>
    </li>
  );
}

function Row({ entry, avatarUrl }: { entry: LeaderboardEntry; avatarUrl: string | null }) {
  return (
    <div
      className={clsx(styles.row, entry.isMe && styles.rowMe)}
      role="row"
      aria-current={entry.isMe ? 'true' : undefined}
    >
      <span role="cell" className={styles.rank}>
        {entry.rank}
      </span>
      <span role="cell" className={styles.person}>
        <EntryAvatar entry={entry} avatarUrl={avatarUrl} size={36} />
        <span className={styles.personText}>
          <span className={styles.personName}>
            <span className={styles.name}>{entry.name}</span>
            {entry.isMe && <span className={styles.meBadge}>Это ты</span>}
            <LevelPill level={entry.level} />
          </span>
          <span className={styles.narrowOnly}>
            Решено {num.format(entry.solved)} · точность{' '}
            {entry.accuracyPercent === null ? '—' : `${entry.accuracyPercent}%`}
          </span>
        </span>
      </span>
      <span role="cell" className={clsx(styles.wideOnly, styles.num)}>
        {num.format(entry.solved)}
      </span>
      <span role="cell" className={clsx(styles.wideOnly, styles.num)}>
        {entry.accuracyPercent === null ? '—' : `${entry.accuracyPercent}%`}
      </span>
      <span role="cell" className={clsx(styles.points, styles.alignEnd)}>
        {num.format(entry.points)}
        <Icon name="star" size={14} className={styles.pointsIcon} />
      </span>
    </div>
  );
}

function MyResult({ board }: { board: LeaderboardResponse }) {
  const { navigate } = useNavigation();
  const me = board.me;
  return (
    <section className={styles.card} aria-labelledby="rating-me">
      <h2 id="rating-me" className={styles.cardTitle}>
        Твой результат
      </h2>
      <div className={styles.meGrid}>
        <div className={styles.meTile}>
          <span className={styles.meBig}>{me.rank === null ? '—' : me.rank}</span>
          <span className={styles.meCaption}>
            {me.rank === null
              ? 'пока не в рейтинге'
              : `место из ${num.format(board.participants)} ${participantsWord(board.participants)}`}
          </span>
        </div>
        <div className={styles.meTile}>
          <span className={styles.meBig}>
            <Icon name="star" size={18} className={styles.pointsIcon} />
            {num.format(me.points)}
          </span>
          <span className={styles.meCaption}>{pointsCaption[board.period]}</span>
        </div>
      </div>
      <p className={styles.meLine}>
        Решено задач: <strong>{num.format(me.solved)}</strong>
        <span aria-hidden="true"> · </span>
        Точность: <strong>{me.accuracyPercent === null ? '—' : `${me.accuracyPercent}%`}</strong>
      </p>
      <Button fullWidth onClick={() => navigate({ screen: 'subjectCatalog' })}>
        Продолжить тренировку <Icon name="arrowRight" size={18} />
      </Button>
    </section>
  );
}

/** Progress to the next level, with the emblems of the ranks involved. */
function NextLevel() {
  const { xp } = useStreakContext();
  const { navigate } = useNavigation();
  if (!xp) return null;
  const rank = levelRankFor(xp.level);
  const nextRank = xp.isMaxLevel ? null : levelRankFor(xp.level + 1);
  const upcoming = nextLevelRank(rank);
  return (
    <section className={styles.card} aria-labelledby="rating-next" style={levelRankStyle(rank)}>
      <h2 id="rating-next" className={styles.cardTitle}>
        До следующего уровня
      </h2>
      <div className={styles.levels}>
        <span className={styles.levelBox}>
          <LevelEmblem rank={rank} size={26} /> Ур. {xp.level}
        </span>
        {nextRank && (
          <>
            <Icon name="arrowRight" size={18} className={styles.levelArrow} />
            <span className={styles.levelBox} style={levelRankStyle(nextRank)}>
              <LevelEmblem rank={nextRank} size={26} /> Ур. {xp.level + 1}
            </span>
          </>
        )}
      </div>
      {xp.isMaxLevel ? (
        <p className={styles.meLine}>Максимальный уровень — опыт продолжает копиться.</p>
      ) : (
        <>
          <div
            className={styles.levelTrack}
            role="progressbar"
            aria-label={`Прогресс до уровня ${xp.level + 1}`}
            aria-valuenow={Math.round(xp.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.round(xp.progress * 100)}%` }} />
          </div>
          <p className={styles.levelNumbers}>
            <span>
              {num.format(xp.xpIntoLevel)} / {num.format(xp.xpForNextLevel ?? 0)} XP
            </span>
            <span>{Math.round(xp.progress * 100)}%</span>
          </p>
        </>
      )}
      {upcoming && (
        <button
          type="button"
          className={styles.reward}
          onClick={() => navigate({ screen: 'level' })}
        >
          <LevelEmblem rank={upcoming} size={30} />
          <span>
            Ранг «{upcoming.name}» — с уровня {upcoming.minLevel}
            <span className={styles.rewardHint}>Новая эмблема и оформление уровня</span>
          </span>
        </button>
      )}
    </section>
  );
}
