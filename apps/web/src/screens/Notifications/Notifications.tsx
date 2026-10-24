import { useCallback, useEffect, useId, useState } from 'react';
import {
  REMINDER_DEFAULT_TIMEZONE,
  isValidTimezone,
  type ReminderSettingsResponse,
} from '@zybrilka/shared';
import { createTelegramLink, getReminders, saveReminders } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import { useNavigation } from '../../lib/navigation.js';
import { SUPPORT_BOT_URL } from '../../lib/telegram.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Select } from '../../ui/Select/Select.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './Notifications.module.css';

/** Russia's zones first (UTC offset in winter), then the browser's own. */
const russianZones: readonly { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (МСК−1)' },
  { value: 'Europe/Moscow', label: 'Москва (МСК)' },
  { value: 'Europe/Samara', label: 'Самара (МСК+1)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (МСК+2)' },
  { value: 'Asia/Omsk', label: 'Омск (МСК+3)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (МСК+4)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (МСК+4)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (МСК+5)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (МСК+6)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (МСК+7)' },
  { value: 'Asia/Magadan', label: 'Магадан (МСК+8)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (МСК+9)' },
];

function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ReminderSettingsResponse };

/** Opens a t.me link: inside the Mini App through Telegram itself. */
function openTelegram(url: string) {
  const webApp = (
    window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }
  ).Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return true;
  }
  return window.open(url, '_blank', 'noopener') !== null;
}

/**
 * «Уведомления» (docs/REMINDERS.md): the daily Telegram reminder — on/off,
 * time and timezone, saved on the server for this account; and the
 * Telegram link it needs, with plain steps when something is missing.
 */
export function Notifications() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const switchId = useId();
  const timeId = useId();

  const refresh = useCallback(() => {
    getReminders().then(
      (data) => setLoad({ status: 'ready', data }),
      () => setLoad({ status: 'error' }),
    );
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  // Back from Telegram after linking: look again.
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, refresh]);

  if (!user) {
    return (
      <SlideUp className={styles.page}>
        <BackRow />
        <h1 className="text-h1">Уведомления</h1>
        <section className={styles.card}>
          <p className="text-body">
            Напоминания настраиваются для аккаунта — войди, чтобы включить их.
          </p>
          <Button onClick={() => navigate({ screen: 'login' })}>Войти</Button>
        </section>
      </SlideUp>
    );
  }

  if (load.status !== 'ready') {
    return (
      <SlideUp className={styles.page}>
        <BackRow />
        <h1 className="text-h1">Уведомления</h1>
        {load.status === 'loading' ? (
          <div aria-busy="true" aria-label="Настройки загружаются">
            <Skeleton height={180} />
          </div>
        ) : (
          <section className={styles.card} role="alert">
            <p className="text-body">Не удалось загрузить настройки.</p>
            <Button variant="secondary" onClick={refresh}>
              Повторить
            </Button>
          </section>
        )}
      </SlideUp>
    );
  }

  const data = load.data;
  const detected = browserTimezone();
  // Never saved yet and still the default zone: offer the device's own.
  const timezone =
    !data.enabled && data.timezone === REMINDER_DEFAULT_TIMEZONE && detected
      ? detected
      : data.timezone;
  const zoneOptions = russianZones.some((z) => z.value === timezone)
    ? russianZones
    : [{ value: timezone, label: `${timezone} (время устройства)` }, ...russianZones];
  const tg = data.telegram;
  const ready = tg.linked && tg.botStarted && !tg.blocked;

  async function save(patch: Partial<{ enabled: boolean; time: string; timezone: string }>) {
    const next = { enabled: data.enabled, time: data.time, timezone, ...patch };
    setSaving(true);
    setSaveError(false);
    try {
      const saved = await saveReminders(next);
      setLoad({ status: 'ready', data: saved });
      setSavedAt(Date.now());
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function link() {
    setLinking(true);
    setLinkError(false);
    try {
      const { token } = await createTelegramLink();
      const url = `${SUPPORT_BOT_URL}?start=link_${token}`;
      setLinkUrl(url);
      openTelegram(url);
    } catch {
      setLinkError(true);
    } finally {
      setLinking(false);
    }
  }

  return (
    <SlideUp className={styles.page}>
      <BackRow />
      <h1 className="text-h1">Уведомления</h1>
      <p className="text-body-sm text-secondary">
        Одно напоминание в день в Telegram — в выбранное тобой время.
      </p>

      <section className={styles.card} aria-labelledby={switchId}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h2 id={switchId} className={styles.title}>
              Ежедневное напоминание
            </h2>
            <p className={styles.state} data-on={data.enabled || undefined}>
              {data.enabled ? 'Включено' : 'Выключено'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={data.enabled}
            aria-labelledby={switchId}
            className={clsx(styles.switch, data.enabled && styles.switchOn)}
            disabled={saving}
            onClick={() => void save({ enabled: !data.enabled })}
          >
            <span className={styles.thumb} />
          </button>
        </div>

        <div className={styles.fields}>
          <label className={styles.field} htmlFor={timeId}>
            <span className={styles.fieldLabel}>Время</span>
            <input
              id={timeId}
              type="time"
              step={300}
              className={styles.timeInput}
              value={timeDraft ?? data.time}
              onChange={(e) => setTimeDraft(e.target.value)}
              // Saved when the field is left (a native picker fires a change
              // per segment — one save at the end, never a jumpy input).
              onBlur={() => {
                if (timeDraft && /^\d{2}:\d{2}$/.test(timeDraft) && timeDraft !== data.time) {
                  void save({ time: timeDraft });
                }
                setTimeDraft(null);
              }}
            />
          </label>
          <div className={styles.field}>
            <Select
              label="Часовой пояс"
              options={zoneOptions}
              value={timezone}
              onChange={(value) => void save({ timezone: value })}
              sheetTitle="Часовой пояс"
              disabled={saving}
            />
          </div>
        </div>

        <p className={styles.preview}>
          <Icon name="chat" size={16} /> «📚 Время потренироваться! Реши несколько заданий ЕГЭ
          сегодня.»
        </p>
        <p className={styles.status} aria-live="polite">
          {saving
            ? 'Сохраняем…'
            : saveError
              ? 'Не удалось сохранить — попробуй ещё раз.'
              : savedAt
                ? 'Сохранено'
                : ''}
        </p>
      </section>

      <section className={styles.card} aria-labelledby="tg-link-title">
        <h2 id="tg-link-title" className={styles.title}>
          Telegram
        </h2>
        {ready ? (
          <p className={styles.ok}>
            <Icon name="success" size={18} /> Telegram привязан — напоминания придут в бота
            Зубрилки. Отключить их можно здесь или кнопкой под напоминанием.
          </p>
        ) : !tg.linked ? (
          <>
            <p className="text-body-sm">
              Напоминания приходят в Telegram-бота Зубрилки. Привяжи свой Telegram к аккаунту:
            </p>
            <ol className={styles.steps}>
              <li>Нажми «Привязать Telegram» — откроется бот.</li>
              <li>В боте нажми «Запустить» (Start).</li>
              <li>Вернись сюда — статус обновится сам.</li>
            </ol>
            <div className={styles.actions}>
              <Button onClick={() => void link()} loading={linking}>
                Привязать Telegram
              </Button>
              <Button variant="secondary" onClick={refresh}>
                Проверить
              </Button>
            </div>
            {linkUrl && (
              <p className="text-body-sm text-secondary">
                Не открылось?{' '}
                <a href={linkUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  Открыть бота
                </a>{' '}
                — ссылка действует 15 минут.
              </p>
            )}
            {linkError && (
              <p className={styles.error} role="alert">
                Не получилось создать ссылку — попробуй ещё раз.
              </p>
            )}
          </>
        ) : tg.blocked ? (
          <p className="text-body-sm">
            Бот Зубрилки заблокирован в Telegram, поэтому напоминания не приходят. Разблокируй его и
            нажми «Запустить» (Start):{' '}
            <a
              href={SUPPORT_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              открыть бота
            </a>
            .
          </p>
        ) : (
          <p className="text-body-sm">
            Telegram привязан, но бот ещё не запущен — Telegram не разрешает ботам писать первыми.
            Открой{' '}
            <a
              href={SUPPORT_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              бота Зубрилки
            </a>{' '}
            и нажми «Запустить» (Start).
          </p>
        )}
      </section>
    </SlideUp>
  );
}
