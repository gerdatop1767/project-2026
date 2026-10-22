import { HBars, LineSeriesChart } from '../components/charts.js';
import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import { Card, DataTable, Kpi, Note, QueryView, Section } from '../components/ui.js';
import { bucketLabel, date, num } from '../format.js';
import { AdminLink } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type TopRow = {
  id: string;
  name: string | null;
  current: number;
  best: number;
  lastActive: string;
};

interface StreaksReport {
  period: PeriodInfo;
  today: string;
  historySince: string | null;
  totals: {
    trackedUsers: number;
    activeStreaks: number;
    averageCurrent: number | null;
    medianCurrent: number | null;
    longestCurrent: number | null;
    longestEver: number | null;
  };
  tiers: { tier: number; label: string; users: number }[];
  daily: { day: string; active: number; averageStreak: number | null; fivePlus: number }[];
  top: TopRow[];
}

/** One colour per tier, in the spirit of the header flame (warm → violet → aurora). */
const tierColors = ['#ff8a2a', '#ff6a1f', '#ff4d6d', '#c04dff', '#7c6bff', '#b05cff'];

/**
 * Серии: how many users hold a streak, how long, and how that changed —
 * all from the same daily-activity table the app's own streak uses.
 */
export function StreaksPage() {
  const q = usePeriodQuery('30d');
  const query = useAdminQuery<StreaksReport>('/streaks', q);
  return (
    <>
      <PageHead
        title="Серии"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
      <QueryView
        query={query}
        skeleton={360}
        isEmpty={(d) => d.totals.trackedUsers === 0}
        empty="Пока ни у одного зарегистрированного пользователя нет дней активности — серий нет."
      >
        {(d) => (
          <>
            <Note>
              Серия — подряд идущие дни (по Москве) хотя бы с одним проверенным ответом, как в шапке
              приложения: она «держится», если пользователь занимался сегодня или вчера. Данные — из
              таблицы дней активности
              {d.historySince ? `, история с ${date(d.historySince)}` : ''}; лучшая серия считается
              по всей сохранённой истории.
            </Note>
            <Section title="Сейчас">
              <div className={s.kpis}>
                <Kpi
                  label="С активной серией"
                  value={d.totals.activeStreaks}
                  hint={`из ${num(d.totals.trackedUsers)} занимавшихся`}
                />
                <Kpi
                  label="Средняя серия, дней"
                  value={d.totals.averageCurrent}
                  hint="среди активных"
                />
                <Kpi label="Медиана, дней" value={d.totals.medianCurrent} hint="среди активных" />
                <Kpi label="Самая длинная сейчас" value={d.totals.longestCurrent} />
                <Kpi label="Рекорд за всё время" value={d.totals.longestEver} />
              </div>
            </Section>

            <Section title="Распределение и динамика">
              <div className={s.cols2}>
                <Card
                  title="По длине серии"
                  note="Пользователи с активной серией, по диапазонам дней"
                >
                  {d.totals.activeStreaks === 0 ? (
                    <p className={s.muted}>Сейчас активных серий нет.</p>
                  ) : (
                    <HBars
                      items={d.tiers.map((t) => ({
                        label: `${t.label} дн.`,
                        value: t.users,
                        color: tierColors[t.tier - 1],
                      }))}
                    />
                  )}
                </Card>
                <Card
                  title="Сколько держат серию"
                  note="Пользователи с серией на конец каждого дня"
                >
                  <LineSeriesChart
                    title="Пользователи с серией по дням"
                    unit="пользователей"
                    series={[
                      { key: 'active', label: 'С серией', color: 'var(--admin-s1)' },
                      { key: 'five', label: '5+ дней', color: 'var(--admin-s2)' },
                    ]}
                    rows={d.daily.map((p) => ({
                      label: bucketLabel(p.day, 'day'),
                      values: { active: p.active, five: p.fivePlus },
                    }))}
                  />
                </Card>
                <Card title="Средняя длина серии" note="Среди тех, кто держит серию в этот день">
                  <LineSeriesChart
                    title="Средняя длина серии по дням"
                    unit="дней"
                    series={[{ key: 'avg', label: 'Средняя серия', color: 'var(--admin-s3)' }]}
                    rows={d.daily.map((p) => ({
                      label: bucketLabel(p.day, 'day'),
                      values: { avg: p.averageStreak },
                    }))}
                  />
                </Card>
              </div>
            </Section>

            <Section title="Самые длинные серии">
              <Card note="Топ-20 активных серий. Только имя и id — без контактов.">
                {d.top.length === 0 ? (
                  <p className={s.muted}>Активных серий нет.</p>
                ) : (
                  <DataTable<TopRow>
                    caption="Самые длинные активные серии"
                    rowKey={(r) => r.id}
                    rows={d.top}
                    columns={[
                      {
                        key: 'name',
                        label: 'Пользователь',
                        render: (r) => (
                          <AdminLink className={s.link} to={`/admin/users/${r.id}`}>
                            {r.name ?? `без имени · ${r.id.slice(0, 8)}`}
                          </AdminLink>
                        ),
                      },
                      { key: 'current', label: 'Серия, дн.', numeric: true },
                      { key: 'best', label: 'Лучшая, дн.', numeric: true },
                      {
                        key: 'lastActive',
                        label: 'Последний день',
                        render: (r) => date(r.lastActive),
                      },
                    ]}
                  />
                )}
              </Card>
            </Section>
          </>
        )}
      </QueryView>
    </>
  );
}
