import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import { Card, DataTable, Kpi, Note, QueryView, Segmented } from '../components/ui.js';
import { date, num, pct } from '../format.js';
import { useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type FunnelStep = {
  key: string;
  label: string;
  count: number;
  fromPrevious: number | null;
  fromStart: number | null;
  dropOff: number | null;
};

interface Funnels {
  period: PeriodInfo;
  trackingSince: string | null;
  visitorData: 'none' | 'partial' | 'full';
  visitors: FunnelStep[];
  guests: { visitors: number; answered: number; returned: number };
  registered: FunnelStep[];
}

interface Thresholds {
  period: PeriodInfo;
  thresholds: { threshold: number; inPeriod: number; ever: number }[];
}

type RetentionCohort = {
  cohort: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
  week1: number | null;
  month1: number | null;
};

interface Retention {
  basis: 'registration' | 'first_activity';
  cohortUnit: 'week' | 'month';
  cohorts: RetentionCohort[];
}

type CohortUnit = Retention['cohortUnit'];
type Basis = Retention['basis'];

const cohortOptions = [
  { value: 'week', label: 'По неделям' },
  { value: 'month', label: 'По месяцам' },
] as const;

const basisOptions = [
  { value: 'registration', label: 'От регистрации' },
  { value: 'first_activity', label: 'От первого ответа' },
] as const;

function FunnelTable({ steps, caption }: { steps: FunnelStep[]; caption: string }) {
  return (
    <DataTable
      caption={caption}
      rows={steps}
      rowKey={(r) => r.key}
      columns={[
        { key: 'label', label: 'Шаг' },
        { key: 'count', label: 'Человек', numeric: true },
        {
          key: 'fromPrevious',
          label: 'От пред.',
          numeric: true,
          render: (r) => (r.fromPrevious === null ? '—' : pct(r.fromPrevious)),
        },
        {
          key: 'fromStart',
          label: 'От начала',
          numeric: true,
          render: (r) => pct(r.fromStart),
        },
        {
          key: 'dropOff',
          label: 'Отвалились',
          numeric: true,
          render: (r) => (r.dropOff === null ? '—' : num(r.dropOff)),
        },
      ]}
    />
  );
}

function FunnelBlock() {
  const q = usePeriodQuery();
  const query = useAdminQuery<Funnels>('/funnels', q);
  return (
    <>
      <PageHead
        title="Воронки и удержание"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
      <QueryView query={query} skeleton={320}>
        {(d) => (
          <>
            {d.visitorData !== 'full' && (
              <Note>
                {d.visitorData === 'none'
                  ? 'Воронка посетителей строится по событиям, а за этот период они не записывались — сбор начался позже.'
                  : `Воронка посетителей строится по событиям, которые собираются с ${date(d.trackingSince)}: более ранние посетители в неё не попали.`}
              </Note>
            )}
            <div className={s.cols2}>
              <Card
                title="Посетители"
                note="Браузеры, впервые зашедшие в периоде; шаг — сделали это когда-либо"
              >
                {d.visitorData === 'none' ? (
                  <p className={s.muted}>Нет данных: события за период не собирались.</p>
                ) : d.visitors[0]?.count === 0 ? (
                  <p className={s.muted}>За период новых посетителей не было.</p>
                ) : (
                  <FunnelTable steps={d.visitors} caption="Воронка посетителей" />
                )}
              </Card>
              <Card title="Зарегистрированные" note="Аккаунты, созданные в периоде; полная история">
                {d.registered[0]?.count === 0 ? (
                  <p className={s.muted}>За период регистраций не было.</p>
                ) : (
                  <FunnelTable steps={d.registered} caption="Воронка зарегистрированных" />
                )}
              </Card>
            </div>
            <div className={s.kpis} style={{ marginTop: 'var(--space-4)' }}>
              <Kpi
                label="Гости (без аккаунта)"
                value={d.visitorData === 'none' ? null : d.guests.visitors}
              />
              <Kpi
                label="Гости с проверенным ответом"
                value={d.visitorData === 'none' ? null : d.guests.answered}
              />
              <Kpi
                label="Гости, вернувшиеся в другой день"
                value={d.visitorData === 'none' ? null : d.guests.returned}
              />
            </div>
          </>
        )}
      </QueryView>
    </>
  );
}

function ThresholdsBlock() {
  const q = usePeriodQuery();
  const query = useAdminQuery<Thresholds>('/thresholds', q);
  return (
    <Card
      title="Пороги решений"
      note="Зарегистрированные пользователи по числу проверенных ответов"
    >
      <QueryView query={query} skeleton={200}>
        {(d) =>
          d.thresholds.length === 0 ? (
            <p className={s.muted}>Пока нет данных.</p>
          ) : (
            <DataTable
              caption="Пороги решений"
              rows={d.thresholds}
              rowKey={(r) => String(r.threshold)}
              columns={[
                {
                  key: 'threshold',
                  label: 'Ответов',
                  render: (r) => `${num(r.threshold)}+`,
                },
                { key: 'inPeriod', label: 'Достигли в периоде', numeric: true },
                {
                  key: 'ever',
                  label: 'Достигли за всё время (на конец периода)',
                  numeric: true,
                },
              ]}
            />
          )
        }
      </QueryView>
    </Card>
  );
}

function RetentionBlock() {
  const { location, setParams } = useAdminRouter();
  const cohort: CohortUnit = location.params.get('cohort') === 'month' ? 'month' : 'week';
  const basis: Basis =
    location.params.get('basis') === 'first_activity' ? 'first_activity' : 'registration';
  const query = useAdminQuery<Retention>('/retention', { cohort, basis });
  const share = (v: number | null) =>
    v === null ? <span className={s.muted}>ещё рано</span> : pct(v);
  return (
    <Card
      title="Удержание по когортам"
      note="Зарегистрированные; активность — хотя бы один проверенный ответ за день (МСК)"
      actions={
        <div className={s.toolbar}>
          <Segmented
            label="Когорты"
            value={cohort}
            options={cohortOptions}
            onChange={(v) => setParams({ cohort: v })}
          />
          <Segmented
            label="Отсчёт"
            value={basis}
            options={basisOptions}
            onChange={(v) => setParams({ basis: v })}
          />
        </div>
      }
    >
      <QueryView
        query={query}
        skeleton={240}
        isEmpty={(d) => d.cohorts.length === 0}
        empty="Пока нет когорт за этот промежуток."
      >
        {(d) => (
          <DataTable
            caption="Удержание по когортам"
            rows={d.cohorts}
            rowKey={(r) => r.cohort}
            columns={[
              {
                key: 'cohort',
                label: d.cohortUnit === 'week' ? 'Неделя с' : 'Месяц',
                render: (r) => (d.cohortUnit === 'week' ? date(r.cohort) : date(r.cohort).slice(3)),
              },
              { key: 'size', label: 'Размер', numeric: true },
              { key: 'd1', label: 'D1', numeric: true, render: (r) => share(r.d1) },
              { key: 'd7', label: 'D7', numeric: true, render: (r) => share(r.d7) },
              { key: 'd30', label: 'D30', numeric: true, render: (r) => share(r.d30) },
              {
                key: 'week1',
                label: '2-я неделя',
                numeric: true,
                render: (r) => share(r.week1),
              },
              {
                key: 'month1',
                label: '2-й месяц',
                numeric: true,
                render: (r) => share(r.month1),
              },
            ]}
          />
        )}
      </QueryView>
    </Card>
  );
}

export function FunnelsPage() {
  return (
    <>
      <FunnelBlock />
      <div className={s.grid} style={{ marginTop: 'var(--space-4)' }}>
        <ThresholdsBlock />
        <RetentionBlock />
        <Note>
          Dn — доля когорты, у которой был проверенный ответ ровно через n дней после своего дня
          отсчёта. «2-я неделя» — активность в дни 7–13, «2-й месяц» — в дни 30–59. «Ещё рано» —
          когорта слишком молодая, чтобы это знать. В воронках «вернулся»: посетитель — зашёл снова
          в более поздний день; зарегистрированный — отвечал хотя бы в два разных дня (по Москве).
        </Note>
      </div>
    </>
  );
}
