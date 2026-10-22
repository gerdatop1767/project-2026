import { LineSeriesChart, StackedBarsChart, HBars, type ChartRow } from '../components/charts.js';
import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import {
  Card,
  GuestDataNote,
  Kpi,
  Note,
  QueryView,
  Section,
  type Compare,
} from '../components/ui.js';
import { adminApi } from '../adminApi.js';
import { bucketLabel, num, pct, ratio, sourceText, taskStatusText } from '../format.js';
import { AdminLink } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

interface Overview {
  period: PeriodInfo;
  trackingSince: string | null;
  guestData: 'none' | 'partial' | 'full';
  users: {
    totalRegistered: number;
    totalAtStart: number;
    registrations: Compare;
    legacyAnonymousUsers: number;
  };
  active: Record<
    'dau' | 'wau' | 'mau',
    { registered: number; guests: number; from: string; to: string }
  >;
  activeInPeriod: { registered: Compare; guests: Compare };
  training: { guestsStarted: Compare; sessionsStarted: Compare; sessionsCompleted: Compare };
  answers: {
    registered: Compare;
    registeredCorrect: Compare;
    guests: Compare;
    guestsCorrect: Compare;
    solvedTasks: Compare;
    uniqueSolvers: Compare;
  };
  tasks: Record<string, number>;
  complaints: { inPeriod: Compare; new: number; inProgress: number };
  series: {
    bucket: string;
    registrations: number;
    correct: number;
    incorrect: number;
    activeRegistered: number;
    guestCorrect: number;
    guestIncorrect: number;
    activeGuests: number;
  }[];
  bySubject: {
    subjectId: string;
    name: string;
    answers: number;
    correct: number;
    guestAnswers: number;
  }[];
  bySource: { source: string; registrations: number }[];
}

interface Health {
  database: { status: 'ok' | 'down' };
  requests: { lastHour: { total: number; serverErrors: number; errorRate: number | null } };
}

export function OverviewPage() {
  const q = usePeriodQuery();
  const query = useAdminQuery<Overview>('/overview', q);
  const health = useAdminQuery<Health>('/health');
  const guestKnown = (v: number) => (query.data?.guestData === 'none' ? null : v);
  return (
    <>
      <PageHead
        title="Обзор"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={
          <>
            <PeriodPicker withGranularity />
            <a className={s.button} href={adminApi.exportUrl('overview', q)} download>
              CSV
            </a>
          </>
        }
      />
      <QueryView query={query} skeleton={420}>
        {(d) => {
          const g = d.period.granularity;
          const rows = (
            pick: (p: Overview['series'][number]) => Record<string, number | null>,
          ): ChartRow[] =>
            d.series.map((p) => ({ label: bucketLabel(p.bucket, g), values: pick(p) }));
          const answersTotal = d.answers.registered.current + d.answers.guests.current;
          return (
            <>
              <GuestDataNote coverage={d.guestData} since={d.trackingSince} />
              <Section title="Ключевые показатели">
                <div className={s.kpis}>
                  <Kpi
                    label="Всего пользователей"
                    value={d.users.totalRegistered}
                    hint={`на начало периода ${num(d.users.totalAtStart)}`}
                  />
                  <Kpi
                    label="Новые регистрации"
                    value={d.users.registrations.current}
                    compare={d.users.registrations}
                    trend={d.series.map((p) => p.registrations)}
                  />
                  <Kpi
                    label="DAU (последний день)"
                    value={d.active.dau.registered}
                    hint={`+ гостей: ${num(guestKnown(d.active.dau.guests))}`}
                  />
                  <Kpi
                    label="WAU (7 дней)"
                    value={d.active.wau.registered}
                    hint={`+ гостей: ${num(guestKnown(d.active.wau.guests))}`}
                  />
                  <Kpi
                    label="MAU (30 дней)"
                    value={d.active.mau.registered}
                    hint={`+ гостей: ${num(guestKnown(d.active.mau.guests))}`}
                  />
                  <Kpi
                    label="Проверено ответов"
                    value={answersTotal}
                    hint={`гостей: ${num(guestKnown(d.answers.guests.current))}`}
                    trend={d.series.map(
                      (p) => p.correct + p.incorrect + p.guestCorrect + p.guestIncorrect,
                    )}
                  />
                  <Kpi
                    label="Верно (зарегистрированные)"
                    value={ratio(d.answers.registeredCorrect.current, d.answers.registered.current)}
                    format={(v) => pct(v)}
                    hint={`${num(d.answers.registeredCorrect.current)} из ${num(d.answers.registered.current)}`}
                  />
                  <Kpi
                    label="Решённые задания"
                    value={d.answers.solvedTasks.current}
                    compare={d.answers.solvedTasks}
                  />
                  <Kpi
                    label="Уникальные решающие"
                    value={d.answers.uniqueSolvers.current}
                    compare={d.answers.uniqueSolvers}
                    trend={d.series.map((p) => p.activeRegistered)}
                  />
                  <Kpi
                    label="Гости, начавшие тренировку"
                    value={guestKnown(d.training.guestsStarted.current)}
                  />
                  <Kpi
                    label="Тренировок начато / завершено"
                    value={d.training.sessionsStarted.current}
                    hint={`завершено ${num(d.training.sessionsCompleted.current)}`}
                  />
                  <Kpi
                    label="Новые жалобы"
                    value={d.complaints.new}
                    hint={`в работе ${num(d.complaints.inProgress)} · за период ${num(d.complaints.inPeriod.current)}`}
                  />
                </div>
              </Section>

              <Section title="Динамика">
                <div className={s.cols2}>
                  <Card title="Регистрации" note="Новые аккаунты по дням (МСК)">
                    <LineSeriesChart
                      title="Регистрации"
                      unit="аккаунтов в день"
                      series={[{ key: 'v', label: 'Регистрации', color: 'var(--admin-s1)' }]}
                      rows={rows((p) => ({ v: p.registrations }))}
                    />
                  </Card>
                  <Card
                    title="Активные пользователи"
                    note="Хотя бы один проверенный ответ за период"
                  >
                    <LineSeriesChart
                      title="Активные пользователи"
                      series={[
                        { key: 'reg', label: 'Зарегистрированные', color: 'var(--admin-s1)' },
                        { key: 'guest', label: 'Гости', color: 'var(--admin-s2)' },
                      ]}
                      rows={rows((p) => ({
                        reg: p.activeRegistered,
                        guest: d.guestData === 'none' ? null : p.activeGuests,
                      }))}
                    />
                  </Card>
                  <Card title="Ответы: верно и неверно" note="Зарегистрированные пользователи">
                    <StackedBarsChart
                      title="Верные и неверные ответы"
                      series={[
                        { key: 'ok', label: 'Верно', color: 'var(--color-success)' },
                        { key: 'bad', label: 'Неверно', color: 'var(--color-error)' },
                      ]}
                      rows={rows((p) => ({ ok: p.correct, bad: p.incorrect }))}
                    />
                  </Card>
                  <Card title="Ответы: гости и зарегистрированные">
                    <StackedBarsChart
                      title="Ответы гостей и зарегистрированных"
                      series={[
                        { key: 'reg', label: 'Зарегистрированные', color: 'var(--admin-s1)' },
                        { key: 'guest', label: 'Гости', color: 'var(--admin-s2)' },
                      ]}
                      rows={rows((p) => ({
                        reg: p.correct + p.incorrect,
                        guest: p.guestCorrect + p.guestIncorrect,
                      }))}
                    />
                  </Card>
                </div>
              </Section>

              <Section title="Структура">
                <div className={s.cols2}>
                  <Card title="По предметам" note="Проверенные ответы за период">
                    {d.bySubject.every((x) => x.answers + x.guestAnswers === 0) ? (
                      <p className={s.muted}>За период ответов не было.</p>
                    ) : (
                      <HBars
                        items={d.bySubject
                          .filter((x) => x.answers + x.guestAnswers > 0)
                          .map((x) => ({
                            label: x.name,
                            value: x.answers + x.guestAnswers,
                            detail: `верно ${pct(ratio(x.correct, x.answers))}`,
                          }))}
                      />
                    )}
                  </Card>
                  <Card
                    title="Регистрации по источникам"
                    note="Только по надёжной атрибуции ссылок"
                  >
                    {d.bySource.length === 0 ? (
                      <p className={s.muted}>За период регистраций не было.</p>
                    ) : (
                      <HBars
                        items={d.bySource.map((x) => ({
                          label: sourceText(x.source),
                          value: x.registrations,
                        }))}
                        color="var(--admin-s3)"
                      />
                    )}
                  </Card>
                </div>
              </Section>

              <Section title="Контент и сервис">
                <div className={s.cols2}>
                  <Card
                    title="Задания по статусам"
                    actions={
                      <AdminLink className={s.link} to="/admin/content">
                        Открыть →
                      </AdminLink>
                    }
                  >
                    <HBars
                      items={Object.entries(d.tasks).map(([status, n]) => ({
                        label: taskStatusText[status] ?? status,
                        value: n,
                      }))}
                      color="var(--admin-s3)"
                    />
                  </Card>
                  <Card
                    title="Состояние сервиса"
                    actions={
                      <AdminLink className={s.link} to="/admin/health">
                        Подробнее →
                      </AdminLink>
                    }
                  >
                    {health.data ? (
                      <dl className={s.dl}>
                        <dt>База данных</dt>
                        <dd>{health.data.database.status === 'ok' ? 'работает' : 'недоступна'}</dd>
                        <dt>Запросов за час</dt>
                        <dd>{num(health.data.requests.lastHour.total)}</dd>
                        <dt>Ошибок сервера за час</dt>
                        <dd>
                          {num(health.data.requests.lastHour.serverErrors)} (
                          {pct(health.data.requests.lastHour.errorRate, 1)})
                        </dd>
                      </dl>
                    ) : (
                      <p className={s.muted}>
                        {health.status === 'error' ? 'Нет данных' : 'Загрузка…'}
                      </p>
                    )}
                  </Card>
                </div>
              </Section>
              {d.users.legacyAnonymousUsers > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <Note>
                    В базе есть {num(d.users.legacyAnonymousUsers)} анонимных записей времён до
                    входа по аккаунтам. Они не считаются пользователями и не входят ни в один
                    показатель.
                  </Note>
                </div>
              )}
            </>
          );
        }}
      </QueryView>
    </>
  );
}
