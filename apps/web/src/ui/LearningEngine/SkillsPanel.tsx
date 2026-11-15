import { useEffect, useState } from 'react';
import type { SkillLevel, SubjectState } from '@zybrilka/shared';
import { getLearningOverview } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import { Button } from '../Button/Button.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import styles from './LearningEngine.module.css';

const LEVEL_LABEL: Record<SkillLevel, string> = {
  none: 'не решал',
  low_data: 'мало данных',
  weak: 'слабо',
  developing: 'в процессе',
  strong: 'уверенно',
};

const TARGET_LABEL: Record<string, string> = {
  unknown: 'не указан',
  '60_plus': '60+',
  '70_plus': '70+',
  '80_plus': '80+',
  '90_plus': '90+',
  '95_plus': '95+',
  '100': '100',
};

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; subject: SubjectState | null };

/**
 * «Навыки» — every EGE number of a subject from the Learning Engine model:
 * mastery, attempts, trend. Below 3 attempts it shows «мало данных», never a
 * percentage that would look more certain than it is.
 */
export function SkillsPanel({ subjectId }: { subjectId: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setState({ status: 'loading' });
    getLearningOverview(subjectId).then(
      (o) => live && setState({ status: 'ready', subject: o.subjects[0] ?? null }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [user, subjectId, attempt]);

  if (!user) return null;
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Навыки загружаются" className={styles.list}>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className={styles.empty}>
        <p className="text-body-sm">Не удалось загрузить навыки.</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </Button>
      </div>
    );
  }
  if (!state.subject) {
    return (
      <p className="text-body-sm text-secondary">
        Этот предмет не выбран в профиле — навыки считаются по выбранным предметам.
      </p>
    );
  }
  const s = state.subject;
  const skills = s.skills.filter((k) => k.examNumber !== null || k.attempts > 0);
  const count = (level: SkillLevel) => skills.filter((k) => k.level === level).length;
  return (
    <section aria-label="Навыки по номерам" className={styles.skills}>
      <div className={styles.summary}>
        <span>
          Цель: <b>{TARGET_LABEL[s.targetScore] ?? '—'}</b>
        </span>
        <span>
          Уверенно: <b>{count('strong')}</b>
        </span>
        <span>
          Слабо: <b>{count('weak')}</b>
        </span>
        <span>
          Мало данных: <b>{count('none') + count('low_data')}</b>
        </span>
      </div>
      <ul className={styles.skillList}>
        {skills.map((k) => {
          const known = k.level !== 'none' && k.level !== 'low_data';
          return (
            <li key={k.key} className={styles.skillRow}>
              <span className={styles.number}>{k.examNumber ? `№${k.examNumber}` : '—'}</span>
              <span className={styles.skillText}>
                <span className={clsx('text-body-sm', styles.skillTitle)}>{k.title}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span
                    className={clsx(styles.barFill, styles[k.level])}
                    style={{ width: known ? `${k.mastery}%` : '0%' }}
                  />
                </span>
              </span>
              <span className={styles.skillMeta}>
                <span className={clsx(styles.level, styles[k.level])}>
                  {known ? `${k.mastery}%` : LEVEL_LABEL[k.level]}
                  {k.trend === 'up' ? ' ↑' : k.trend === 'down' ? ' ↓' : ''}
                </span>
                <span className="text-label text-secondary">
                  {k.attempts > 0 ? `${k.correct}/${k.attempts}` : '—'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
