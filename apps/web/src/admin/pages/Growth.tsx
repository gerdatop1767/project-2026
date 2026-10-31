import { LineSeriesChart, HBars, type ChartRow } from '../components/charts.js';
import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import { Card, GuestDataNote, Kpi, Note, QueryView } from '../components/ui.js';
import { adminApi } from '../adminApi.js';
import { bucketLabel, changeText, num, sourceText } from '../format.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

interface GrowthPoint {
  bucket: string;
  registrations: number;
  totalUsers: number;
  activeRegistered: number;
  returning: number;
  firstTraining: number;
  firstSolve: number;
  activeGuests: number;
  guestVisitors: number;
}

interface Growth {
  period: PeriodInfo;
  trackingSince: string | null;
  guestData: 'none' | 'partial' | 'full';
  totals: {
    registrations: number;
    previousRegistrations: number;
    growthPercent: number | null;
    totalUsersAtEnd: number;
    totalUsersAtStart: number;
    userBaseGrowthPercent: number | null;
  };
  series: GrowthPoint[];
  byMethod: { method: string; registrations: number }[];
  bySource: { source: string; channel: string | null; registrations: number }[];
  bySubject: { subjectId: string; name: string; activeUsers: number; answers: number }[];
}

const methodText: Record<string, string> = {
  email: 'Почта',
  vk: 'VK ID',
  telegram: 'Telegram',
  yandex: 'Яндекс ID',
  unknown: 'Неизвестно',
};

export function GrowthPage() {
  const q = usePeriodQuery();
  const query = useAdminQuery<Growth>('/growth', q);
  return (
    <>
      <PageHead
        title="Аналитика и рост"
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
          const rows = (pick: (p: GrowthPoint) => Record<string, number | null>): ChartRow[] =>
            d.series.map((p) => ({ label: bucketLabel(p.bucket, g), values: pick(p) }));
          const t = d.totals;
          const activeSubjects = d.bySubject.filter((x) => x.answers > 0);
          return (
            <>
              <GuestDataNote coverage={d.guestData} since={d.trackingSince} />
              <div className={s.kpis}>
                <Kpi
                  label="Регистрации за период"
                  value={t.registrations}
                  compare={{
                    current: t.registrations,
                    previous: t.previousRegistrations,
                    changePercent: t.growthPercent,
                  }}
                />
                <Kpi label="Пользователей на начало" value={t.totalUsersAtStart} />
                <Kpi
                  label="Пользователей на конец"
                  value={t.totalUsersAtEnd}
                  hint={`рост базы: ${changeText(t.userBaseGrowthPercent)}`}
                />
              </div>

              <div className={s.cols2}>
                <Card title="Всего пользователей" note="Зарегистрированные на конец шага">
                  <LineSeriesChart
                    title="Всего пользователей"
                    series={[{ key: 'v', label: 'Пользователи', color: 'var(--admin-s1)' }]}
                    rows={rows((p) => ({ v: p.totalUsers }))}
                  />
                </Card>
                <Card title="Регистрации" note="Новые аккаунты за шаг">
                  <LineSeriesChart
                    title="Регистрации"
                    series={[{ key: 'v', label: 'Регистрации', color: 'var(--admin-s1)' }]}
                    rows={rows((p) => ({ v: p.registrations }))}
                  />
                </Card>
                <Card title="Активные" note="Хотя бы один проверенный ответ за шаг">
                  <LineSeriesChart
                    title="Активные зарегистрированные и гости"
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
                <Card title="Первые шаги и возвраты" note="Зарегистрированные пользователи">
                  <LineSeriesChart
                    title="Первая тренировка, первое решение, вернувшиеся"
                    series={[
                      { key: 'ft', label: 'Первая тренировка', color: 'var(--admin-s1)' },
                      { key: 'fs', label: 'Первое верное решение', color: 'var(--admin-s2)' },
                      { key: 'ret', label: 'Вернувшиеся', color: 'var(--admin-s3)' },
                    ]}
                    rows={rows((p) => ({
                      ft: p.firstTraining,
                      fs: p.firstSolve,
                      ret: p.returning,
                    }))}
                  />
                </Card>
                <Card title="Регистрации по способу входа" note="Первый привязанный способ входа">
                  {d.byMethod.length === 0 ? (
                    <p className={s.muted}>За период регистраций не было.</p>
                  ) : (
                    <HBars
                      items={d.byMethod.map((x) => ({
                        label: methodText[x.method] ?? x.method,
                        value: x.registrations,
                      }))}
                    />
                  )}
                </Card>
                <Card title="Регистрации по источникам" note="Источник и канал кампании">
                  {d.bySource.length === 0 ? (
                    <p className={s.muted}>За период регистраций не было.</p>
                  ) : (
                    <HBars
                      items={d.bySource.map((x) => ({
                        label: x.channel
                          ? `${sourceText(x.source)} · ${x.channel}`
                          : sourceText(x.source),
                        value: x.registrations,
                      }))}
                      color="var(--admin-s3)"
                    />
                  )}
                </Card>
                <Card title="По предметам" note="Активные зарегистрированные и их ответы">
                  {activeSubjects.length === 0 ? (
                    <p className={s.muted}>За период ответов не было.</p>
                  ) : (
                    <HBars
                      items={activeSubjects.map((x) => ({
                        label: x.name,
                        value: x.activeUsers,
                        detail: `ответов ${num(x.answers)}`,
                      }))}
                      color="var(--admin-s2)"
                    />
                  )}
                </Card>
              </div>

              <div style={{ marginTop: 'var(--space-4)' }}>
                <Note>
                  Активный — хотя бы один проверенный ответ за шаг. Вернувшийся — активен в шаге и
                  был активен раньше. Дни считаются по Москве.
                </Note>
              </div>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
