import { useEffect, useId, useState } from 'react';
import type { NotificationPreferences } from '@zybrilka/shared';
import {
  getProgressNotificationPreferences,
  saveProgressNotificationPreferences,
} from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import notifStyles from '../../screens/Notifications/Notifications.module.css';
import styles from './PersonalLearning.module.css';

/**
 * «Уведомления о прогрессе» (docs/learning/PERSONAL-PLANS.md § Уведомления):
 * separate from the daily reminder — progress / goal messages, plan
 * reminders, and «только важное». Saved on the server, read by the worker.
 */
export function ProgressNotificationSettings() {
  const progressId = useId();
  const planId = useId();
  const freqId = useId();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getProgressNotificationPreferences().then(
      (p) =>
        live &&
        setPrefs({
          progressEnabled: p.progressEnabled,
          planRemindersEnabled: p.planRemindersEnabled,
          frequency: p.frequency,
        }),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  async function save(next: NotificationPreferences) {
    const before = prefs;
    setPrefs(next);
    setSaving(true);
    try {
      await saveProgressNotificationPreferences(next);
    } catch {
      setPrefs(before);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) {
    return failed ? (
      <p className="text-body-sm text-secondary" role="alert">
        Не удалось загрузить настройки уведомлений о прогрессе.
      </p>
    ) : null;
  }
  const toggle = (
    id: string,
    label: string,
    hint: string,
    on: boolean,
    key: keyof NotificationPreferences,
  ) => (
    <div className={notifStyles.row}>
      <div className={notifStyles.rowText}>
        <h3 id={id} className={notifStyles.title}>
          {label}
        </h3>
        <p className={notifStyles.state} data-on={on || undefined}>
          {hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        className={clsx(notifStyles.switch, on && notifStyles.switchOn)}
        disabled={saving}
        onClick={() => void save({ ...prefs, [key]: !on })}
      >
        <span className={notifStyles.thumb} />
      </button>
    </div>
  );
  return (
    <section className={notifStyles.card} aria-label="Уведомления о прогрессе">
      <h2 className={notifStyles.title}>Уведомления о прогрессе</h2>
      <p className="text-body-sm text-secondary">
        Telegram-сообщения о росте результатов, выполненном плане и контрольной тренировке. Не чаще
        двух в день и только днём.
      </p>
      {toggle(
        progressId,
        'Прогресс и цели',
        prefs.progressEnabled ? 'Сообщения о росте и целях придут' : 'Не присылаются',
        prefs.progressEnabled,
        'progressEnabled',
      )}
      {toggle(
        planId,
        'Напоминания по плану',
        prefs.planRemindersEnabled ? '«Сегодня по плану…» придёт' : 'Не присылаются',
        prefs.planRemindersEnabled,
        'planRemindersEnabled',
      )}
      <label className={styles.toggleRow} htmlFor={freqId}>
        <span>Частота</span>
        <select
          id={freqId}
          value={prefs.frequency}
          disabled={saving}
          onChange={(e) =>
            void save({
              ...prefs,
              frequency: e.target.value as NotificationPreferences['frequency'],
            })
          }
        >
          <option value="normal">Обычная</option>
          <option value="important">Только важное</option>
        </select>
      </label>
      {failed && (
        <p role="alert" className={styles.error}>
          Не удалось сохранить. Попробуй ещё раз.
        </p>
      )}
    </section>
  );
}
