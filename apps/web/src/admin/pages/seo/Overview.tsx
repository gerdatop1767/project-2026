import { Fragment, useState } from 'react';
import { LineSeriesChart, type ChartRow } from '../../components/charts.js';
import { PageHead } from '../../components/Shell.js';
import { Card, Kpi, Note, QueryView, Segmented } from '../../components/ui.js';
import { num, pct } from '../../format.js';
import { useAdminQuery } from '../../useAdminQuery.js';
import { AdminLink } from '../../router.js';
import { SeoTabs, integrationStatusText } from './common.js';
import s from '../../admin.module.css';

type Days = '7' | '30' | '90';

interface Kpis {
  organicVisits: number | null;
  organicUsers: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  top3: number | null;
  top10: number | null;
  top50: number | null;
  publishedArticles: number;
  externalPublished: number;
  seoRegistrations: number;
  organicGoalReaches: number | null;
  conversion: number | null;
}

interface Overview {
  days: number;
  current: Kpis;
  previous: Kpis;
  compare: Record<keyof Kpis, number | null>;
  totals: {
    publishedArticles: number;
    externalPublished: number;
    indexedPages: number | null;
    indexedArticles: number | null;
  };
  series: {
    date: string;
    organic: number | null;
    published: number;
    position: number | null;
    indexed: number | null;
    externalClicks: number;
    registrations: number;
    goals: number | null;
  }[];
  sources: Record<string, { status: string; lastSyncAt: string | null; lastError: string | null }>;
}

export function SeoOverviewPage() {
  const [days, setDays] = useState<Days>('30');
  const query = useAdminQuery<Overview>('/seo/overview', { days });
  return (
    <>
      <PageHead
        title="AI SEO Center"
        subtitle={
          <p className={s.subtitle}>
            Органический трафик, позиции и работа SEO-агента. Только реальные данные подключённых
            источников.
          </p>
        }
        actions={
          <Segmented<Days>
            label="Период"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 дней' },
              { value: '30', label: '30 дней' },
              { value: '90', label: '90 дней' },
            ]}
          />
        }
      />
      <SeoTabs />
      <QueryView query={query} skeleton={480}>
        {(d) => {
          const c = d.current;
          const cmp = (k: keyof Kpis) =>
            c[k] === null || d.previous[k] === null
              ? undefined
              : {
                  current: c[k] as number,
                  previous: d.previous[k] as number,
                  changePercent: d.compare[k],
                };
          const rows = (
            pick: (p: Overview['series'][number]) => Record<string, number | null>,
          ): ChartRow[] =>
            d.series.map((p) => ({
              label: p.date.slice(5).split('-').reverse().join('.'),
              values: pick(p),
            }));
          const missing = ['yandex_metrika', 'yandex_webmaster', 'google_search_console'].filter(
            (k) => d.sources[k]?.status !== 'connected',
          );
          return (
            <>
              {missing.length > 0 && (
                <Note>
                  Не подключено:{' '}
                  {missing
                    .map(
                      (k) =>
                        ({
                          yandex_metrika: 'Яндекс Метрика',
                          yandex_webmaster: 'Яндекс Вебмастер',
                          google_search_console: 'Google Search Console',
                        })[k],
                    )
                    .join(', ')}
                  . Показатели из этих источников показаны как «Недостаточно данных».{' '}
                  <AdminLink to="/admin/seo/integrations" className={s.link}>
                    Подключить
                  </AdminLink>
                </Note>
              )}
              <div className={s.kpis}>
                <Kpi
                  label="Органический трафик (визиты)"
                  value={c.organicVisits}
                  compare={cmp('organicVisits')}
                  trend={d.series.map((p) => p.organic ?? 0)}
                />
                <Kpi
                  label="Посетители из поиска"
                  value={c.organicUsers}
                  compare={cmp('organicUsers')}
                />
                <Kpi label="Переходы из поиска (клики)" value={c.clicks} compare={cmp('clicks')} />
                <Kpi label="Показы в поиске" value={c.impressions} compare={cmp('impressions')} />
                <Kpi
                  label="CTR из выдачи"
                  value={c.ctr}
                  compare={cmp('ctr')}
                  format={(v) => pct(v, 1)}
                />
                <Kpi
                  label="Средняя позиция"
                  value={c.avgPosition}
                  compare={cmp('avgPosition')}
                  format={(v) => (v === null || v === undefined ? '—' : v.toFixed(1))}
                  hint="меньше — лучше"
                />
                <Kpi label="Запросов в ТОП-3" value={c.top3} compare={cmp('top3')} />
                <Kpi label="Запросов в ТОП-10" value={c.top10} compare={cmp('top10')} />
                <Kpi label="Запросов в ТОП-50" value={c.top50} compare={cmp('top50')} />
                <Kpi
                  label="Опубликовано статей (всего)"
                  value={d.totals.publishedArticles}
                  hint={`за период: ${num(c.publishedArticles)}`}
                />
                <Kpi
                  label="Внешних публикаций (всего)"
                  value={d.totals.externalPublished}
                  hint={`за период: ${num(c.externalPublished)}`}
                />
                <Kpi
                  label="Статей в индексе Яндекса"
                  value={d.totals.indexedArticles}
                  hint={
                    d.totals.indexedPages !== null
                      ? `страниц сайта в поиске: ${num(d.totals.indexedPages)}`
                      : undefined
                  }
                />
                <Kpi
                  label="Регистрации из SEO"
                  value={c.seoRegistrations}
                  compare={cmp('seoRegistrations')}
                  hint="по ссылкам статей и внешних публикаций"
                />
                <Kpi
                  label="Конверсия в регистрацию"
                  value={c.conversion}
                  compare={cmp('conversion')}
                  format={(v) => pct(v, 2)}
                  hint={
                    c.organicGoalReaches !== null
                      ? 'по цели Метрики'
                      : 'регистрации из SEO / визиты'
                  }
                />
              </div>
              <p className={s.small}>
                Сравнение — с предыдущими {d.days} днями. Данные Вебмастера и Search Console
                приходят с задержкой 2–5 дней.
              </p>

              <div className={s.cols2}>
                <Card
                  title="Рост органического трафика"
                  note="Визиты из поисковых систем (Метрика)"
                >
                  {d.series.some((p) => p.organic !== null) ? (
                    <LineSeriesChart
                      title="Органический трафик"
                      unit="визитов"
                      series={[{ key: 'v', label: 'Визиты', color: 'var(--admin-s1)' }]}
                      rows={rows((p) => ({ v: p.organic }))}
                    />
                  ) : (
                    <p className={s.muted}>Нет данных — подключите Яндекс Метрику.</p>
                  )}
                </Card>
                <Card title="Динамика публикаций" note="Статей опубликовано за день">
                  <LineSeriesChart
                    title="Публикации"
                    series={[{ key: 'v', label: 'Статьи', color: 'var(--admin-s2)' }]}
                    rows={rows((p) => ({ v: p.published }))}
                  />
                </Card>
                <Card
                  title="Поисковые позиции"
                  note="Средняя позиция по всем запросам (Вебмастер + GSC)"
                >
                  {d.series.some((p) => p.position !== null) ? (
                    <LineSeriesChart
                      title="Средняя позиция"
                      series={[{ key: 'v', label: 'Позиция', color: 'var(--admin-s1)' }]}
                      rows={rows((p) => ({
                        v: p.position === null ? null : Math.round(p.position * 10) / 10,
                      }))}
                    />
                  ) : (
                    <p className={s.muted}>Нет данных — подключите Вебмастер или Search Console.</p>
                  )}
                </Card>
                <Card title="Проиндексированные страницы" note="Страниц сайта в поиске Яндекса">
                  {d.series.some((p) => p.indexed !== null) ? (
                    <LineSeriesChart
                      title="Индексация"
                      series={[{ key: 'v', label: 'Страниц', color: 'var(--admin-s3)' }]}
                      rows={rows((p) => ({ v: p.indexed }))}
                    />
                  ) : (
                    <p className={s.muted}>Нет данных — подключите Яндекс Вебмастер.</p>
                  )}
                </Card>
                <Card
                  title="Переходы с внешних площадок"
                  note="Клики по отслеживаемым ссылкам публикаций"
                >
                  <LineSeriesChart
                    title="Внешние переходы"
                    series={[{ key: 'v', label: 'Переходы', color: 'var(--admin-s2)' }]}
                    rows={rows((p) => ({ v: p.externalClicks }))}
                  />
                </Card>
                <Card
                  title="Регистрации из органики"
                  note="По ссылкам статей и публикаций (атрибуция кампаний)"
                >
                  <LineSeriesChart
                    title="Регистрации"
                    series={[
                      { key: 'r', label: 'Регистрации (SEO-ссылки)', color: 'var(--admin-s1)' },
                      ...(d.series.some((p) => p.goals !== null)
                        ? [{ key: 'g', label: 'Цель Метрики (органика)', color: 'var(--admin-s3)' }]
                        : []),
                    ]}
                    rows={rows((p) => ({ r: p.registrations, g: p.goals }))}
                  />
                </Card>
              </div>
              <Card title="Источники данных">
                <dl className={s.dl}>
                  {Object.entries(d.sources).map(([k, v]) => (
                    <Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {integrationStatusText[v.status] ?? v.status}
                        {v.lastSyncAt
                          ? ` · синхронизация ${new Date(v.lastSyncAt).toLocaleString('ru-RU')}`
                          : ''}
                        {v.lastError ? ` · ${v.lastError}` : ''}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </Card>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
