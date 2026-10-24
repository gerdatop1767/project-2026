import { useState } from 'react';
import type { AdminNotificationSettings } from '@zybrilka/shared';
import { PageHead } from '../components/Shell.js';
import { Badge, Card, ErrorState, Kpi, Note, QueryView } from '../components/ui.js';
import { WorkerStatusList, type WorkerStatusInfo } from '../components/WorkerStatus.js';
import { adminApi } from '../adminApi.js';
import { dateTime } from '../format.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

interface NotificationsResponse {
  settings: AdminNotificationSettings;
  delivery: { botConfigured: boolean; owners: number; withTelegram: number };
  worker: WorkerStatusInfo | null;
  lastResult: { status: string; lastError: string | null; at: string } | null;
  queue: { pending: number; failed24h: number; sent24h: number; lastSentAt: string | null };
}

const kinds: { key: keyof AdminNotificationSettings; title: string; text: string }[] = [
  {
    key: 'registrations',
    title: 'Новые регистрации',
    text: 'Когда появляется новый аккаунт: время, способ входа, источник (кампания) и ID. Повторный вход не присылается.',
  },
  {
    key: 'siteErrors',
    title: 'Сбои сайта',
    text: 'Ошибки сервера (5xx) — сгруппированы, одинаковые не чаще раза в 15 минут; недоступность сайта или базы данных и восстановление.',
  },
  {
    key: 'complaints',
    title: 'Жалобы на задания',
    text: 'Каждая новая жалоба: номер, предмет, задание, категория, текст и кнопка «Открыть жалобу».',
  },
];

/** What still stands between the owner and the notifications, in order. */
function deliveryProblem(d: NotificationsResponse): string | null {
  if (!d.delivery.botConfigured) {
    return 'На сервере (API) не задан TELEGRAM_BOT_TOKEN — бот ничего не отправит.';
  }
  if (d.delivery.owners === 0) return 'Не задан ADMIN_OWNER_USER_IDS — некому отправлять.';
  if (d.delivery.withTelegram === 0) {
    return 'К аккаунту владельца не подключён Telegram: «Профиль → Способы входа → Telegram» (в Mini App).';
  }
  if (!d.worker || d.worker.stale)
    return 'Фоновый процесс (worker) не работает — отправлять некому.';
  if (!d.worker.botConfigured)
    return 'У worker не задан TELEGRAM_BOT_TOKEN — он ничего не отправит.';
  return null;
}

/** The last delivery outcome, in words. */
const lastResultText: Record<string, string> = {
  not_started:
    'Telegram не дал написать владельцу: откройте бота в Telegram и нажмите «Запустить» (Start). Потом отправьте тестовое уведомление.',
  no_recipients: 'Некому было отправить: у владельца не подключён Telegram.',
  disabled: 'Этот тип уведомлений выключен.',
  network: 'Telegram был недоступен — сообщение не дошло после повторов.',
  rate_limited: 'Telegram попросил подождать (лимит) — сообщение не дошло после повторов.',
  rejected: 'Telegram отклонил сообщение.',
};

/**
 * «Уведомления» — what the owner gets in Telegram. Each switch saves at
 * once (server-side, audited); switching a kind off only stops the message —
 * registrations, complaints and error logging carry on.
 */
export function NotificationsPage() {
  const query = useAdminQuery<NotificationsResponse>('/notifications');
  const [saving, setSaving] = useState<keyof AdminNotificationSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<'idle' | 'busy' | 'queued'>('idle');

  const toggle = async (
    settings: AdminNotificationSettings,
    key: keyof AdminNotificationSettings,
  ) => {
    setSaving(key);
    setError(null);
    setSaved(null);
    try {
      await adminApi.put('/notifications', { ...settings, [key]: !settings[key] });
      setSaved(key);
      query.reload();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(null);
    }
  };

  const sendTest = async () => {
    setTest('busy');
    setError(null);
    try {
      await adminApi.post('/notifications/test', {});
      setTest('queued');
      query.reload();
    } catch (e) {
      setError(e);
      setTest('idle');
    }
  };

  return (
    <>
      <PageHead title="Уведомления" />
      <QueryView query={query} skeleton={360}>
        {(d) => {
          const problem = deliveryProblem(d);
          const last = d.lastResult;
          return (
            <div className={s.grid}>
              <Note>
                Приходят только владельцу в Telegram — от бота Зубрилки. Обычные пользователи их
                никогда не получают.
              </Note>
              {error !== null && <ErrorState error={error} compact />}
              <Card title="Что присылать" note="Изменение сохраняется сразу и пишется в журнал">
                <ul className={s.switchList}>
                  {kinds.map((k) => (
                    <li key={k.key} className={s.switchRow}>
                      <label className={s.switchLabel}>
                        <input
                          type="checkbox"
                          role="switch"
                          className={s.switch}
                          checked={d.settings[k.key]}
                          disabled={saving !== null}
                          aria-describedby={`notify-${k.key}`}
                          onChange={() => void toggle(d.settings, k.key)}
                        />
                        <span>
                          <strong>{k.title}</strong>{' '}
                          <Badge tone={d.settings[k.key] ? 'good' : 'neutral'}>
                            {d.settings[k.key] ? 'включено' : 'выключено'}
                          </Badge>
                        </span>
                      </label>
                      <p id={`notify-${k.key}`} className={s.small}>
                        {k.text}
                      </p>
                      {saved === k.key && (
                        <span role="status" className={s.small}>
                          Сохранено
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
              <div className={s.cols2}>
                <Card title="Доставка">
                  <dl className={s.dl}>
                    <dt>Бот</dt>
                    <dd>
                      <Badge tone={d.delivery.botConfigured ? 'good' : 'bad'}>
                        {d.delivery.botConfigured ? 'токен задан' : 'не настроен'}
                      </Badge>
                    </dd>
                    <dt>Владельцы</dt>
                    <dd>{d.delivery.owners}</dd>
                    <dt>С Telegram</dt>
                    <dd>{d.delivery.withTelegram}</dd>
                    <dt>Последняя попытка</dt>
                    <dd>
                      {last ? (
                        <>
                          <Badge tone={last.status === 'sent' ? 'good' : 'warn'}>
                            {last.status === 'sent' ? 'доставлено' : 'не доставлено'}
                          </Badge>{' '}
                          <span className={s.small}>{dateTime(last.at)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </dl>
                  {problem ? (
                    <p className={s.small} role="alert">
                      {problem}
                    </p>
                  ) : last && last.status !== 'sent' && last.lastError ? (
                    <p className={s.small} role="alert">
                      {lastResultText[last.lastError] ?? `Не доставлено: ${last.lastError}`}
                    </p>
                  ) : (
                    <p className={s.small}>
                      Настройки в порядке. Если владелец ещё не нажимал «Запустить» в боте, сделайте
                      это и отправьте тестовое уведомление.
                    </p>
                  )}
                  <div className={s.toolbar}>
                    <button
                      type="button"
                      className={s.button}
                      disabled={test === 'busy' || Boolean(problem)}
                      onClick={() => void sendTest()}
                    >
                      Отправить тестовое уведомление
                    </button>
                    {test === 'queued' && (
                      <span role="status" className={s.small}>
                        Поставлено в очередь — придёт в течение минуты.
                      </span>
                    )}
                  </div>
                </Card>
                <Card title="Фоновый процесс">
                  <WorkerStatusList worker={d.worker} />
                </Card>
                <Card title="Очередь" note="Отправляет фоновый процесс (worker)">
                  <div className={s.kpis}>
                    <Kpi label="Ждут отправки" value={d.queue.pending} />
                    <Kpi label="Отправлено за 24 ч" value={d.queue.sent24h} />
                    <Kpi label="Не доставлено за 24 ч" value={d.queue.failed24h} />
                  </div>
                  <p className={s.small}>
                    Последняя отправка: {d.queue.lastSentAt ? dateTime(d.queue.lastSentAt) : '—'}
                  </p>
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
