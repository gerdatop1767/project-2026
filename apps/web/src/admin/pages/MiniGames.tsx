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

export interface MiniGamesReport {
  period: PeriodInfo;
  games: { id: string; title: string }[];
  gameId: string;
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
export function MiniGamesPage() {
  const q = usePeriodQuery('30d');
  const { location, setParams } = useAdminRouter();
  const game = location.params.get('game') ?? 'stress';
  const query = useAdminQuery<MiniGamesReport>('/mini-games', { ...q, game });

  return (
    <>
      <PageHead
        title="Мини-игры"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
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
            <Note>
              {d.games.find((g) => g.id === d.gameId)?.title ?? d.gameId}. Запуски, завершённые
              раунды, результаты и время — из журнала раундов
              {d.sessionsSince
                ? `, который ведётся с ${date(d.sessionsSince)}: раньше запуски не записывались и не восстанавливаются`
                : ': он пока пуст — раунды начнут считаться после обновления'}
              . Игроки, ответы, точность и возвращаемость — по ответам вошедших учеников
              {d.answersSince ? `, история с ${date(d.answersSince)}` : ''}. Гость — только запуск:
              у него нет учётной записи, поэтому он не считается игроком.
            </Note>

            <Section title="Запуски и раунды">
              <div className={s.kpis}>
                <Kpi
                  label="Запуски"
                  value={d.rounds.launches}
                  hint={`из них гостей: ${num(d.rounds.guestLaunches)}`}
                />
                <Kpi
                  label="Уникальные игроки"
                  value={d.rounds.players}
                  hint="вошедшие, запускали"
                />
                <Kpi
                  label="Повторные запуски"
                  value={d.rounds.repeatPlayers}
                  hint={`игроков с 2+ раундами · ${percent(d.rounds.repeatPlayersPercent)}`}
                />
                <Kpi
                  label="Раундов на игрока"
                  value={d.rounds.launchesPerPlayer}
                  format={decimal}
                />
                <Kpi
                  label="Завершено раундов"
                  value={d.rounds.finished}
                  hint={`${percent(d.rounds.finishedPercent)} запусков дошли до итога`}
                />
              </div>
              <div className={s.kpis}>
                <Kpi
                  label="С первого раза за раунд"
                  value={d.rounds.avgCorrect}
                  format={decimal}
                  hint={
                    d.rounds.avgQuestions !== null
                      ? `в среднем из ${decimal(d.rounds.avgQuestions)} слов`
                      : 'среди завершённых'
                  }
                />
                <Kpi
                  label="Правильных ответов"
                  value={d.rounds.correctPercent}
                  format={percent}
                  hint="все ответы в раундах, с повторами и гостями"
                />
                <Kpi
                  label="Среднее время раунда"
                  value={d.rounds.avgSeconds}
                  format={duration}
                  hint={`медиана ${duration(d.rounds.medianSeconds)}`}
                />
              </div>
            </Section>

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

            <Section title="Динамика по дням">
              <div className={s.cols2}>
                <Card title="Запуски" note="Журнал раундов: все и завершённые">
                  <LineSeriesChart
                    title="Запуски по дням"
                    unit="раундов"
                    series={[
                      { key: 'launches', label: 'Запуски', color: 'var(--admin-s1)' },
                      { key: 'finished', label: 'Завершены', color: 'var(--admin-s2)' },
                    ]}
                    rows={d.daily.map((p) => ({
                      label: bucketLabel(p.day, 'day'),
                      values: { launches: p.launches, finished: p.finished },
                    }))}
                  />
                </Card>
                <Card title="Игроки" note="Вошедшие ученики, ответившие в этот день">
                  <LineSeriesChart
                    title="Игроки по дням"
                    unit="игроков"
                    series={[{ key: 'players', label: 'Игроки', color: 'var(--admin-s3)' }]}
                    rows={d.daily.map((p) => ({
                      label: bucketLabel(p.day, 'day'),
                      values: { players: p.players },
                    }))}
                  />
                </Card>
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
