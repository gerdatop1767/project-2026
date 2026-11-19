import { useEffect, useId, useState } from 'react';
import {
  FREQUENCY_LABELS,
  FREQUENCY_RULES,
  progressFrequencies,
  type NotificationPreferences,
} from '@zybrilka/shared';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
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
    ) : (
      <Skeleton height={260} aria-label="Загрузка настроек прогресса" />
    );
  }
  const toggle = (
    id: string,
    icon: IconName,
    label: string,
    hint: string,
    on: boolean,
    key: 'progressEnabled' | 'planRemindersEnabled',
  ) => (
    <div className={notifStyles.option}>
      <span className={notifStyles.optionIcon} aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className={notifStyles.rowText}>
        <h3 id={id} className={notifStyles.optionTitle}>
          {label}
        </h3>
        <p className={notifStyles.optionHint}>{hint}</p>
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
  const rules = FREQUENCY_RULES[prefs.frequency];
  return (
    <section className={notifStyles.card} aria-label="Уведомления о прогрессе">
      <div className={notifStyles.cardHead}>
        <span className={notifStyles.cardIcon} aria-hidden="true">
          <Icon name="progress" size={22} />
        </span>
        <div className={notifStyles.rowText}>
          <h2 className={notifStyles.cardTitle}>Уведомления о прогрессе</h2>
          <p className={notifStyles.cardLead}>
            Рассказываем о твоих результатах, плане и прогрессе в подготовке.
          </p>
        </div>
      </div>
      <div className={notifStyles.options}>
        {toggle(
          progressId,
          'target',
          'Прогресс и цели',
          'Уведомления о росте результатов и приближении к целям.',
          prefs.progressEnabled,
          'progressEnabled',
        )}
        {toggle(
          planId,
          'calendar',
          'Напоминания по плану',
          'Сообщения о запланированных тренировках.',
          prefs.planRemindersEnabled,
          'planRemindersEnabled',
        )}
      </div>
      <div className={notifStyles.frequency}>
        <p id={freqId} className={notifStyles.frequencyLabel}>
          <Icon name="xp" size={18} /> Частота уведомлений
        </p>
        <div className={notifStyles.segments} role="radiogroup" aria-labelledby={freqId}>
          {progressFrequencies.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={prefs.frequency === f}
              disabled={saving}
              className={clsx(notifStyles.segment, prefs.frequency === f && notifStyles.segmentOn)}
              onClick={() => prefs.frequency !== f && void save({ ...prefs, frequency: f })}
            >
              {prefs.frequency === f && <Icon name="check" size={16} />}
              {FREQUENCY_LABELS[f]}
            </button>
          ))}
        </div>
        <p className={notifStyles.frequencyHint} aria-live="polite">
          До {rules.maxPerDay} {rules.maxPerDay === 1 ? 'сообщения' : 'сообщений'} в день, только с
          10:00 до 21:00.{' '}
          {rules.planReminders
            ? `Напоминание по плану — после ${rules.planFromMinute / 60}:00, если день плана не выполнен.`
            : 'Без ежедневных напоминаний по плану — только результаты.'}
          {prefs.frequency === 'extended' ? ' Сообщаем и о небольшом росте результата.' : ''}
        </p>
      </div>
      {failed && (
        <p role="alert" className={styles.error}>
          Не удалось сохранить. Попробуй ещё раз.
        </p>
      )}
    </section>
  );
}
