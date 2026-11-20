import { HBars, LineSeriesChart } from '../components/charts.js';
import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import { Card, DataTable, Kpi, Note, QueryView, Section, Segmented } from '../components/ui.js';
import { bucketLabel, date, NO_DATA, num } from '../format.js';
import { useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

export type GameTotals = {
  launches: number;
  guestLaunches: number;
  players: number;
  finished: number;
  solved: number;
  correct: number;
  wrong: number;
  correctPercent: number | null;
  avgSeconds: number | null;
  medianSeconds: number | null;
  avgQuestions: number | null;
  repeatPlayers: number;
};
type CompareMap = Record<string, { previous: number | null; changePercent: number | null }>;
interface SeriesPoint {
  bucket: string;
  launches: number;
  finished: number;
  players: number;
  guestLaunches: number;
  solved: number;
  correct: number;
  correctPercent: number | null;
}
export type QuestionStat = {
  itemId: string;
  answered: number;
  correct: number;
  wrong: number;
  retried: number;
  stuckPlayers: number;
  correctPercent: number;
  text: string | null;
  answer: string | null;
};
export interface MiniGamesOverview {
  period: PeriodInfo;
  sessionsSince: string | null;
  questionsSince: string | null;
  totals: GameTotals;
  compare: CompareMap;
  games: ({
    id: string;
    title: string;
    subjectId: string;
    launchesChange: number | null;
  } & GameTotals)[];
  popular: { id: string; title: string; launches: number; players: number }[];
  bestSuccess: { id: string; title: string; correctPercent: number | null; solved: number }[];
  worstSuccess: { id: string; title: string; correctPercent: number | null; solved: number }[];
  minSolvedForRank: number;
  series: SeriesPoint[];
}

export interface MiniGamesReport {
  period: PeriodInfo;
  games: { id: string; title: string }[];
  gameId: string;
  questionsSince: string | null;
  totals: GameTotals;
  compare: CompareMap;
  series: SeriesPoint[];
  questions: {
    questionsInRange: number;
    minAnswersForRank: number;
    hardest: QuestionStat[];
    easiest: QuestionStat[];
    mostMistakes: QuestionStat[];
    struggling: QuestionStat[];
  };
  sessionsSince: string | null;
  answersSince: string | null;
  rounds: {
    launches: number;
    guestLaunches: number;
    players: number;
    repeatPlayers: number;
    repeatPlayersPercent: number | null;
    launchesPerPlayer: number | null;
    finished: number;
    finishedPercent: number | null;
    avgCorrect: number | null;
    avgQuestions: number | null;
    correctPercent: number | null;
    avgSeconds: number | null;
    medianSeconds: number | null;
    results: { label: string; rounds: number }[];
    modes: { mode: string; launches: number; finished: number }[];
  };
  answers: {
    players: number;
    newPlayers: number;
    answers: number;
    correctPercent: number | null;
    multiDayPlayers: number;
    multiDayPercent: number | null;
    returning: {
      cohort: number;
      d1: number;
      d1Percent: number | null;
      eligible7: number;
      d7: number;
      d7Percent: number | null;
    };
  };
  daily: {
    day: string;
    launches: number;
    finished: number;
    sessionPlayers: number;
    players: number;
    answers: number;
    correct: number;
  }[];
}

/** Percent values come from the API already ×100 (one decimal). */
const percent = (v: number | null | undefined) =>
  v === null || v === undefined ? NO_DATA : `${String(v).replace('.', ',')}%`;
const decimal = (v: number | null | undefined) =>
  v === null || v === undefined ? NO_DATA : String(v).replace('.', ',');
function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return NO_DATA;
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return m > 0 ? `${m} мин ${sec} с` : `${sec} с`;
}

const modeLabels: Record<string, string> = {
  all: 'Тренировка',
  mistakes: 'Мои ошибки',
  hard: 'Сложные слова',
};
const resultColors = ['#ff4d6d', '#ff8a2a', '#f5c518', '#7c6bff', '#22c55e'];

/**
 * Мини-игры: launches, finished rounds, results and time come from the
 * round log (since it exists); players, answers, accuracy and returning
 * players from the signed-in answers (whole history). The two are labelled
 * apart, never blended. One page for every game in the registry.
 */
/** The presets this report offers. */
const MINI_GAME_PERIODS = ['today', '7d', '15d', '30d', '90d', 'all'] as const;

const cmp = (current: number | null, c: CompareMap[string] | undefined) =>
  current === null || !c || c.previous === null
    ? undefined
    : { current, previous: c.previous, changePercent: c.changePercent };

const seriesRows = (series: SeriesPoint[], granularity: PeriodInfo['granularity']) =>
  series.map((p) => ({ label: bucketLabel(p.bucket, granularity), p }));

/** Мини-игры: all games together, or one game when `game` is in the URL. */
export function MiniGamesPage() {
  const { location } = useAdminRouter();
  const game = location.params.get('game');
  return game ? <GameDetail game={game} /> : <Overview />;
}

/** The headline numbers, the same set on the overview and on a game's page. */
function TotalsKpis({ t, c }: { t: GameTotals; c: CompareMap }) {
  return (
    <>
      <div className={s.kpis}>
        <Kpi
          label="Запуски"
          value={t.launches}
          compare={cmp(t.launches, c.launches)}
          hint={`из них гостей: ${num(t.guestLaunches)}`}
        />
        <Kpi
          label="Уникальные игроки"
          value={t.players}
          compare={cmp(t.players, c.players)}
          hint="вошедшие; гость игроком не считается"
        />
        <Kpi
          label="Завершено раундов"
          value={t.finished}
          compare={cmp(t.finished, c.finished)}
          hint="дошли до итога раунда"
        />
        <Kpi label="Повторные прохождения" value={t.repeatPlayers} hint="игроков с 2+ раундами" />
      </div>
      <div className={s.kpis}>
        <Kpi
          label="Решено вопросов"
          value={t.solved}
          compare={cmp(t.solved, c.solved)}
          hint="вопрос раунда считается один раз"
        />
        <Kpi
          label="Правильных ответов"
          value={t.correct}
          compare={cmp(t.correct, c.correct)}
          hint={`неправильных: ${num(t.wrong)} · по первому ответу`}
        />
        <Kpi
          label="Доля правильных"
          value={t.correctPercent}
          format={percent}
          hint={
            c.correctPercent?.changePercent !== null &&
            c.correctPercent?.changePercent !== undefined
              ? `${c.correctPercent.changePercent > 0 ? '+' : ''}${decimal(c.correctPercent.changePercent)} п.п. к прошлому периоду`
              : 'нет базы для сравнения'
          }
        />
        <Kpi
          label="Среднее время игры"
          value={t.avgSeconds}
          format={duration}
          hint={`медиана ${duration(t.medianSeconds)} · завершённые раунды`}
        />
        <Kpi
          label="Вопросов за игру"
          value={t.avgQuestions}
          format={decimal}
          compare={cmp(t.avgQuestions, c.avgQuestions)}
          hint="в среднем на раунд с ответами"
        />
      </div>
    </>
  );
}

/** Launches/players and solved/right charts over the period. */
function SeriesCharts({
  series,
  granularity,
}: {
  series: SeriesPoint[];
  granularity: PeriodInfo['granularity'];
}) {
  const r = seriesRows(series, granularity);
  return (
    <div className={s.cols2}>
      <Card title="Запуски" note="Все раунды и завершённые">
        <LineSeriesChart
          title="Запуски игр"
          unit="раундов"
          series={[
            { key: 'launches', label: 'Запуски', color: 'var(--admin-s1)' },
            { key: 'finished', label: 'Завершены', color: 'var(--admin-s2)' },
          ]}
          rows={r.map(({ label, p }) => ({
            label,
            values: { launches: p.launches, finished: p.finished },
          }))}
        />
      </Card>
      <Card title="Активные пользователи" note="Вошедшие игроки и гостевые запуски">
        <LineSeriesChart
          title="Активные пользователи"
          unit="человек"
          series={[
            { key: 'players', label: 'Игроки', color: 'var(--admin-s3)' },
            { key: 'guests', label: 'Гостевые запуски', color: 'var(--admin-s4)' },
          ]}
          rows={r.map(({ label, p }) => ({
            label,
            values: { players: p.players, guests: p.guestLaunches },
          }))}
        />
      </Card>
      <Card
        title="Решённые вопросы"
        note="Вопрос раунда — один раз; правильные — по первому ответу"
      >
        <LineSeriesChart
          title="Решённые вопросы"
          unit="вопросов"
          series={[
            { key: 'solved', label: 'Решено', color: 'var(--admin-s1)' },
            { key: 'correct', label: 'Правильно', color: 'var(--admin-s2)' },
          ]}
          rows={r.map(({ label, p }) => ({
            label,
            values: { solved: p.solved, correct: p.correct },
          }))}
        />
      </Card>
      <Card title="Динамика правильных ответов" note="Доля правильных первых ответов, %">
        <LineSeriesChart
          title="Доля правильных ответов"
          unit="%"
          series={[{ key: 'pct', label: 'Правильных, %', color: 'var(--admin-s3)' }]}
          rows={r.map(({ label, p }) => ({ label, values: { pct: p.correctPercent ?? 0 } }))}
        />
      </Card>
    </div>
  );
}

function DataSinceNote({ questionsSince }: { questionsSince: string | null }) {
  return (
    <Note>
      Запуск — выданный раунд, в том числе гостю. Игрок — вошедший ученик; гость считается только
      запуском. Раунд завершён, когда игрок дошёл до итога. Решённый вопрос — ответ на вопрос
      раунда: повторный ответ или повторно отправленный запрос его не удваивают; правильный — если
      верен первый ответ. Дни — по Москве.{' '}
      {questionsSince
        ? `Данные по вопросам ведутся с ${date(questionsSince)}: раньше вопросы раундов не записывались.`
        : 'Данные по вопросам начнут собираться после обновления: раньше вопросы раундов не записывались.'}
    </Note>
  );
}

function Overview() {
  const q = usePeriodQuery('30d');
  const { setParams } = useAdminRouter();
  const query = useAdminQuery<MiniGamesOverview>('/mini-games/overview', q);
  return (
    <>
      <PageHead
        title="Мини-игры"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker only={MINI_GAME_PERIODS} />}
      />
      <QueryView query={query} skeleton={420}>
        {(d) => (
          <>
            <DataSinceNote questionsSince={d.questionsSince} />
            <Section title="Все игры за период">
              <TotalsKpis t={d.totals} c={d.compare} />
            </Section>
            <Section title="Динамика">
              <SeriesCharts series={d.series} granularity={d.period.granularity} />
            </Section>
            <Section title="Популярность и успешность">
              <div className={s.cols2}>
                <Card title="Самые популярные" note="По запускам">
                  {d.popular.length === 0 ? (
                    <p className={s.muted}>Запусков за период нет.</p>
                  ) : (
                    <HBars
                      items={d.popular.map((g) => ({
                        label: g.title,
                        value: g.launches,
                        detail: `${num(g.players)} игроков`,
                      }))}
                    />
                  )}
                </Card>
                <Card
                  title="Успешность"
                  note={`Доля правильных первых ответов; в рейтинге — игры с ${d.minSolvedForRank}+ решёнными вопросами`}
                >
                  {d.bestSuccess.length === 0 ? (
                    <p className={s.muted}>Пока мало ответов для сравнения игр.</p>
                  ) : (
                    <>
                      <p className={s.muted}>Самая высокая</p>
                      <HBars
                        color="var(--admin-s2)"
                        items={d.bestSuccess.map((g) => ({
                          label: g.title,
                          value: g.correctPercent ?? 0,
                          detail: `${percent(g.correctPercent)} · ${num(g.solved)} вопр.`,
                        }))}
                      />
                      <p className={s.muted}>Самая низкая</p>
                      <HBars
                        color="var(--admin-danger, #ff4d6d)"
                        items={d.worstSuccess.map((g) => ({
                          label: g.title,
                          value: g.correctPercent ?? 0,
                          detail: `${percent(g.correctPercent)} · ${num(g.solved)} вопр.`,
                        }))}
                      />
                    </>
                  )}
                </Card>
              </div>
            </Section>
            <Section title="Все игры">
              <DataTable<MiniGamesOverview['games'][number]>
                caption="Статистика каждой игры — нажми на название, чтобы открыть"
                rowKey={(g) => g.id}
                rows={d.games}
                columns={[
                  {
                    key: 'title',
                    label: 'Игра',
                    render: (g) => (
                      <button
                        type="button"
                        className={s.linkButton}
                        onClick={() => setParams({ game: g.id })}
                      >
                        {g.title}
                      </button>
                    ),
                  },
                  { key: 'launches', label: 'Запуски', numeric: true },
                  { key: 'players', label: 'Игроки', numeric: true },
                  { key: 'finished', label: 'Завершены', numeric: true },
                  { key: 'solved', label: 'Решено вопр.', numeric: true },
                  {
                    key: 'correctPercent',
                    label: 'Правильных',
                    numeric: true,
                    render: (g) => percent(g.correctPercent),
                  },
                  {
                    key: 'avgSeconds',
                    label: 'Ср. время',
                    numeric: true,
                    render: (g) => duration(g.avgSeconds),
                  },
                ]}
              />
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}

function QuestionTable({ rows, empty }: { rows: QuestionStat[]; empty: string }) {
  if (rows.length === 0) return <p className={s.muted}>{empty}</p>;
  return (
    <DataTable<QuestionStat>
      caption="Вопросы"
      rowKey={(r) => r.itemId}
      rows={rows}
      columns={[
        {
          key: 'text',
          label: 'Вопрос',
          render: (r) =>
            r.text ? (
              <span>
                {r.text}
                {r.answer && <span className={s.muted}> · ответ: {r.answer}</span>}
              </span>
            ) : (
              <span className={s.muted}>вопроса уже нет в банке</span>
            ),
        },
        { key: 'answered', label: 'Ответов', numeric: true },
        { key: 'wrong', label: 'Ошибок', numeric: true },
        {
          key: 'correctPercent',
          label: 'Правильных',
          numeric: true,
          render: (r) => percent(r.correctPercent),
        },
      ]}
    />
  );
}

function GameDetail({ game }: { game: string }) {
  const q = usePeriodQuery('30d');
  const { setParams } = useAdminRouter();
  const query = useAdminQuery<MiniGamesReport>('/mini-games', { ...q, game });

  return (
    <>
      <PageHead
        title={query.data?.games.find((g) => g.id === game)?.title ?? 'Мини-игра'}
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker only={MINI_GAME_PERIODS} />}
      />
      <button
        type="button"
        className={`${s.linkButton} ${s.backLink}`}
        onClick={() => setParams({ game: null })}
      >
        ← Все мини-игры
      </button>
      <QueryView query={query} skeleton={360}>
        {(d) => (
          <>
            {d.games.length > 1 && (
              <Segmented
                label="Игра"
                value={d.gameId}
                options={d.games.map((g) => ({ value: g.id, label: g.title }))}
                onChange={(id) => setParams({ game: id })}
              />
            )}
            <DataSinceNote questionsSince={d.questionsSince} />
            <Section title="Главное за период">
              <TotalsKpis t={d.totals} c={d.compare} />
            </Section>
            <Section title="Популярность и успешность">
              <SeriesCharts series={d.series} granularity={d.period.granularity} />
            </Section>
            <Section title="Вопросы">
              <div className={s.cols2}>
                <Card
                  title="Самые сложные"
                  note={`Меньше всего правильных первых ответов, от ${d.questions.minAnswersForRank} ответов`}
                >
                  <QuestionTable rows={d.questions.hardest} empty="Пока мало ответов на вопросы." />
                </Card>
                <Card
                  title="Самые лёгкие"
                  note={`Больше всего правильных первых ответов, от ${d.questions.minAnswersForRank} ответов`}
                >
                  <QuestionTable rows={d.questions.easiest} empty="Пока мало ответов на вопросы." />
                </Card>
                <Card title="Больше всего ошибок" note="Неправильные первые ответы">
                  <QuestionTable rows={d.questions.mostMistakes} empty="Ошибок за период нет." />
                </Card>
                <Card
                  title="Вызывают затруднения"
                  note="Игрок ошибся в двух и более раундах или повторял ответ в раунде"
                >
                  <QuestionTable rows={d.questions.struggling} empty="Затруднений за период нет." />
                </Card>
              </div>
            </Section>
            <Note>
              Возвращаемость и результаты раундов — по журналу раундов
              {d.sessionsSince
                ? `, который ведётся с ${date(d.sessionsSince)}: раньше запуски не записывались и не восстанавливаются`
                : ': он пока пуст — раунды начнут считаться после обновления'}
              , и по ответам вошедших учеников
              {d.answersSince ? ` (история с ${date(d.answersSince)})` : ''}.
            </Note>

            <Section title="Игроки и возвращаемость">
              <div className={s.kpis}>
                <Kpi label="Активные игроки" value={d.answers.players} hint="ответили хоть раз" />
                <Kpi
                  label="Новые игроки"
                  value={d.answers.newPlayers}
                  hint="первая игра в периоде"
                />
                <Kpi label="Ответов" value={d.answers.answers} />
                <Kpi label="Точность" value={d.answers.correctPercent} format={percent} />
                <Kpi
                  label="Играли в 2+ дня"
                  value={d.answers.multiDayPlayers}
                  hint={percent(d.answers.multiDayPercent)}
                />
                <Kpi
                  label="Вернулись на след. день"
                  value={d.answers.returning.d1Percent}
                  format={percent}
                  hint={`${num(d.answers.returning.d1)} из ${num(d.answers.returning.cohort)} новых`}
                />
                <Kpi
                  label="Вернулись за 7 дней"
                  value={d.answers.returning.d7Percent}
                  format={percent}
                  hint={`${num(d.answers.returning.d7)} из ${num(d.answers.returning.eligible7)} — у кого прошло 7 дней`}
                />
              </div>
            </Section>

            <Section title="Результаты раундов">
              <div className={s.cols2}>
                <Card title="Результат раунда" note="Доля слов с первого раза, завершённые раунды">
                  {d.rounds.finished === 0 ? (
                    <p className={s.muted}>Завершённых раундов за период нет.</p>
                  ) : (
                    <HBars
                      items={d.rounds.results.map((r, i) => ({
                        label: r.label,
                        value: r.rounds,
                        color: resultColors[i],
                      }))}
                    />
                  )}
                </Card>
                <Card title="По режимам">
                  {d.rounds.modes.length === 0 ? (
                    <p className={s.muted}>Запусков за период нет.</p>
                  ) : (
                    <DataTable<MiniGamesReport['rounds']['modes'][number]>
                      caption="Запуски по режимам"
                      rowKey={(r) => r.mode}
                      rows={d.rounds.modes}
                      columns={[
                        {
                          key: 'mode',
                          label: 'Режим',
                          render: (r) => modeLabels[r.mode] ?? r.mode,
                        },
                        { key: 'launches', label: 'Запуски', numeric: true },
                        { key: 'finished', label: 'Завершены', numeric: true },
                      ]}
                    />
                  )}
                </Card>
              </div>
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}
