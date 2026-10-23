import { useEffect } from 'react';
import { PageHead } from '../components/Shell.js';
import { Badge, Card, DataTable, Note, QueryView, ValueOrNoData } from '../components/ui.js';
import { dateTime, num, pct } from '../format.js';
import { AdminLink } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

interface Health {
  api: { status: 'ok'; version: string; processStartedAt: string; uptimeSeconds: number };
  database: { status: 'ok' | 'down'; latencyMs: number | null };
  requests: {
    sinceStart: { total: number; serverErrors: number };
    lastHour: { total: number; serverErrors: number; errorRate: number | null };
    latencyLast15m: { samples: number; p50: number | null; p95: number | null };
    topErrors: { route: string; method: string; status: number; count: number }[];
  };
  answerChecks: { lastHour: number; rejected: number; serverErrors: number };
  auth: {
    lastHour: number;
    failed: number;
    serverErrors: number;
    vkRequests: number;
    vkFailed: number;
  };
  analytics: { lastEventAt: string | null };
  content: { lastTaskUpdate: string | null };
  unknown: Record<string, string>;
}

interface Alerts {
  alerts: { type: string; severity: 'critical' | 'warning'; title: string; detail: string }[];
  checkedAt: string;
  channels: Record<string, string>;
  notObservable: string[];
}

const REFRESH_MS = 60_000;

const notObservableText: Record<string, string> = { import_failure: 'сбои импорта заданий' };

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

const ms = (v: number | null) => (v === null ? null : `${num(v)} мс`);

/** Re-run `reload` every minute while the tab is visible, and on return to it. */
function useAutoRefresh(reload: () => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(reload, REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reload();
        start();
      } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);
}

export function HealthPage() {
  const health = useAdminQuery<Health>('/health');
  const alerts = useAdminQuery<Alerts>('/alerts');
  const reloadHealth = health.reload;
  const reloadAlerts = alerts.reload;
  useAutoRefresh(reloadHealth);
  useAutoRefresh(reloadAlerts);
  const busy = health.status === 'loading' || alerts.status === 'loading';
  return (
    <>
      <PageHead
        title="Техническое состояние"
        subtitle={
          <p className={s.subtitle}>
            Метрики запросов — с момента запуска процесса API. Обновляется раз в минуту.
          </p>
        }
        actions={
          <button
            type="button"
            className={s.button}
            disabled={busy}
            onClick={() => {
              reloadHealth();
              reloadAlerts();
            }}
          >
            {busy ? 'Обновление…' : 'Обновить'}
          </button>
        }
      />

      <div className={s.grid}>
        <Card
          title="Оповещения"
          note={alerts.data && `Проверено ${dateTime(alerts.data.checkedAt)}`}
        >
          <QueryView
            query={alerts}
            skeleton={80}
            isEmpty={(d) => d.alerts.length === 0}
            empty="Сейчас всё спокойно."
          >
            {(d) => (
              <ul className={s.grid} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {d.alerts.map((a) => (
                  <li key={a.type}>
                    <Badge tone={a.severity === 'critical' ? 'bad' : 'warn'}>
                      {a.severity === 'critical' ? 'Критично' : 'Внимание'}
                    </Badge>{' '}
                    <strong>{a.title}</strong>
                    <p className={s.small}>{a.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
          {alerts.data && (
            <Note>
              Эти тревоги видны только здесь. В Telegram приходят только уведомления, настроенные в
              разделе{' '}
              <AdminLink className={s.link} to="/admin/notifications">
                «Уведомления»
              </AdminLink>{' '}
              (регистрации, сбои сайта, жалобы).
              {alerts.data.notObservable.length > 0 &&
                ` Не отслеживаются: ${alerts.data.notObservable
                  .map((k) => notObservableText[k] ?? k)
                  .join(', ')} — API их не видит.`}
            </Note>
          )}
        </Card>

        <QueryView query={health} skeleton={360}>
          {(d) => (
            <>
              <div className={s.cols2}>
                <Card title="API">
                  <dl className={s.dl}>
                    <dt>Статус</dt>
                    <dd>
                      <Badge tone="good">работает</Badge>
                    </dd>
                    <dt>Версия</dt>
                    <dd className={s.mono}>{d.api.version}</dd>
                    <dt>Процесс запущен</dt>
                    <dd>{dateTime(d.api.processStartedAt)}</dd>
                    <dt>Работает</dt>
                    <dd>{uptime(d.api.uptimeSeconds)}</dd>
                  </dl>
                </Card>
                <Card title="База данных">
                  <dl className={s.dl}>
                    <dt>Статус</dt>
                    <dd>
                      {d.database.status === 'ok' ? (
                        <Badge tone="good">работает</Badge>
                      ) : (
                        <Badge tone="bad">недоступна</Badge>
                      )}
                    </dd>
                    <dt>Задержка запроса</dt>
                    <dd>
                      <ValueOrNoData value={ms(d.database.latencyMs)} />
                    </dd>
                  </dl>
                </Card>
                <Card title="Запросы" note="С момента запуска процесса API">
                  <dl className={s.dl}>
                    <dt>Всего с запуска</dt>
                    <dd>{num(d.requests.sinceStart.total)}</dd>
                    <dt>Ошибок сервера с запуска</dt>
                    <dd>{num(d.requests.sinceStart.serverErrors)}</dd>
                    <dt>За последний час</dt>
                    <dd>{num(d.requests.lastHour.total)}</dd>
                    <dt>Ошибок 5xx за час</dt>
                    <dd>
                      {num(d.requests.lastHour.serverErrors)} (
                      {pct(d.requests.lastHour.errorRate, 1)})
                    </dd>
                  </dl>
                </Card>
                <Card title="Скорость ответа" note="Последние 15 минут">
                  <dl className={s.dl}>
                    <dt>Медиана (p50)</dt>
                    <dd>
                      <ValueOrNoData value={ms(d.requests.latencyLast15m.p50)} />
                    </dd>
                    <dt>p95</dt>
                    <dd>
                      <ValueOrNoData value={ms(d.requests.latencyLast15m.p95)} />
                    </dd>
                    <dt>Запросов в выборке</dt>
                    <dd>{num(d.requests.latencyLast15m.samples)}</dd>
                  </dl>
                </Card>
                <Card title="Проверка ответов" note="Последний час">
                  <dl className={s.dl}>
                    <dt>Запросов</dt>
                    <dd>{num(d.answerChecks.lastHour)}</dd>
                    <dt>Отклонено (4xx/5xx)</dt>
                    <dd>{num(d.answerChecks.rejected)}</dd>
                    <dt>Ошибок сервера</dt>
                    <dd>{num(d.answerChecks.serverErrors)}</dd>
                  </dl>
                </Card>
                <Card title="Вход" note="Последний час">
                  <dl className={s.dl}>
                    <dt>Запросов входа</dt>
                    <dd>{num(d.auth.lastHour)}</dd>
                    <dt>Неуспешных (4xx/5xx)</dt>
                    <dd>{num(d.auth.failed)}</dd>
                    <dt>Ошибок сервера</dt>
                    <dd>{num(d.auth.serverErrors)}</dd>
                    <dt>VK ID: запросов / неуспешных</dt>
                    <dd>
                      {num(d.auth.vkRequests)} / {num(d.auth.vkFailed)}
                    </dd>
                  </dl>
                </Card>
                <Card title="Данные">
                  <dl className={s.dl}>
                    <dt>Последнее событие аналитики</dt>
                    <dd>
                      <ValueOrNoData
                        value={d.analytics.lastEventAt && dateTime(d.analytics.lastEventAt)}
                      />
                    </dd>
                    <dt>Последнее изменение задания</dt>
                    <dd>
                      <ValueOrNoData
                        value={d.content.lastTaskUpdate && dateTime(d.content.lastTaskUpdate)}
                      />
                    </dd>
                  </dl>
                </Card>
                <Card title="Не отслеживается">
                  <ul className={s.small}>
                    {Object.entries(d.unknown).map(([key, text]) => (
                      <li key={key}>
                        {text.startsWith('Нет данных') ? text : `Нет данных: ${text}`}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Card title="Частые ошибки сервера" note="Последний час, до 10 записей">
                  {d.requests.topErrors.length === 0 ? (
                    <p className={s.muted}>Ошибок сервера за час не было.</p>
                  ) : (
                    <DataTable
                      caption="Частые ошибки сервера"
                      rows={d.requests.topErrors}
                      rowKey={(r) => `${r.method} ${r.route} ${r.status}`}
                      columns={[
                        { key: 'method', label: 'Метод' },
                        {
                          key: 'route',
                          label: 'Маршрут',
                          render: (r) => <span className={s.mono}>{r.route}</span>,
                        },
                        { key: 'status', label: 'Код', numeric: true },
                        { key: 'count', label: 'Раз', numeric: true },
                      ]}
                    />
                  )}
                </Card>
              </div>
            </>
          )}
        </QueryView>
      </div>
    </>
  );
}
