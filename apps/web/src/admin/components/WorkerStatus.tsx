import { Badge } from './ui.js';
import { dateTime } from '../format.js';
import s from '../admin.module.css';

/** What the worker reported about itself (see @zybrilka/shared WorkerStatus). */
export interface WorkerStatusInfo {
  at: string;
  botConfigured: boolean;
  polling: boolean;
  healthCheck: boolean;
  owners: number;
  stale: boolean;
}

const onOff = (on: boolean, onText = 'включено', offText = 'выключено') => (
  <Badge tone={on ? 'good' : 'warn'}>{on ? onText : offText}</Badge>
);

/**
 * The background worker's own report: is it running, does it read the
 * bot's messages (/start), does it watch the site. Shown so the owner can
 * see from the admin panel — not server logs — why something is not sent.
 */
export function WorkerStatusList({ worker }: { worker: WorkerStatusInfo | null }) {
  if (!worker) {
    return (
      <p className={s.small} role="alert">
        Фоновый процесс (worker) ещё ни разу не сообщил о себе: он не запущен или работает старая
        версия. Без него ничего не отправляется.
      </p>
    );
  }
  return (
    <>
      <dl className={s.dl}>
        <dt>Worker</dt>
        <dd>
          {worker.stale ? (
            <Badge tone="bad">не отвечает с {dateTime(worker.at)}</Badge>
          ) : (
            <Badge tone="good">работает</Badge>
          )}
        </dd>
        <dt>Токен бота у worker</dt>
        <dd>{onOff(worker.botConfigured, 'задан', 'не задан')}</dd>
        <dt>Приём сообщений бота (/start)</dt>
        <dd>{onOff(worker.polling)}</dd>
        <dt>Проверка доступности сайта</dt>
        <dd>{onOff(worker.healthCheck)}</dd>
      </dl>
      {!worker.polling && (
        <p className={s.small}>
          Пока приём сообщений выключен (TELEGRAM_BOT_POLLING), бот не видит /start: новые
          подписчики не появляются, и у рассылок нет получателей. Уведомлениям владельцу это не
          мешает.
        </p>
      )}
      {worker.botConfigured && !worker.healthCheck && (
        <p className={s.small}>
          Проверка доступности выключена: у worker не задан API_HEALTH_URL. Уведомления о
          недоступности сайта и базы не придут; ошибки 5xx, регистрации и жалобы — придут.
        </p>
      )}
    </>
  );
}
