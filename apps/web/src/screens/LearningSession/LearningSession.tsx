import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { getLearningSession } from '../../lib/api.js';
import {
  applyLearningSessionResponse,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { VariantAttempt } from '../VariantAttempt/VariantAttempt.js';
import styles from './LearningSession.module.css';

export interface LearningSessionProps {
  sessionId: string;
}

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — the one addressable entry
 * point for a real backend learning session. Two jobs, both read-only
 * against the backend (never advances a task slot, never re-runs
 * scoring):
 *
 * 1. Recovery: mounted on a page refresh or direct link, it has no
 *    primed context (React state doesn't survive a reload), so it calls
 *    `GET /me/learning/sessions/:id` to recover the server-authoritative
 *    current task/position, then hands off into the existing `task`
 *    overlay — never silently starts a new session or resets position.
 * 2. Completion: once the session has run its course (`next`/`start`/a
 *    recovery read all report `status: 'completed'`), this is where
 *    that lands and stays — showing ONLY the real backend summary
 *    fields, never an invented stat.
 *
 * When the context already holds this exact session's active state
 * (the normal path: Training's "Умная тренировка" just started it, or
 * Result's "Следующее задание" just advanced it), there's nothing to
 * recover — this redirects straight into the task without an extra
 * request.
 */
export function LearningSession({ sessionId }: LearningSessionProps) {
  const { navigate } = useNavigation();
  const { session, setSession, clearSession } = useLearningSessionContext();
  const [error, setError] = useState<string | null>(null);

  const primed = session && session.sessionId === sessionId ? session : null;

  useEffect(() => {
    if (primed) return;
    let cancelled = false;
    void getLearningSession(sessionId)
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setError('Эта тренировка больше не доступна.');
          return;
        }
        applyLearningSessionResponse(response, setSession, navigate);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить тренировку.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, primed]);

  // On the normal path (session already primed and active — just
  // started or just advanced), this screen is a pure redirect with
  // nothing to show: it never actually has to load anything. Using
  // useLayoutEffect (not useEffect) runs the navigate() before the
  // browser paints the commit below, so the "Загрузка тренировки…"
  // placeholder further down never becomes visible — without it, that
  // placeholder paints for one frame and then disappears, which is
  // exactly the kind of wrong-intermediate-content flash a real fix
  // (not a delay/animation mask) needs to prevent at the source.
  useLayoutEffect(() => {
    if (!primed || primed.status !== 'active') return;
    navigate({
      screen: 'task',
      subjectId: primed.subjectId,
      taskNumber: primed.currentTaskNumber,
      taskId: primed.currentTaskId,
      returnTo: { screen: 'learningSession', sessionId },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primed]);

  if (error) {
    return (
      <SlideUp className={styles.page}>
        <p className="text-body-sm text-secondary">{error}</p>
        <Button variant="secondary" onClick={() => navigate({ screen: 'training' })}>
          К тренировкам
        </Button>
      </SlideUp>
    );
  }

  // A finished variant: its full result — the same screen Statistics
  // opens for this attempt.
  if (primed && primed.status === 'completed' && primed.variant) {
    return (
      <div className={styles.page}>
        <VariantAttempt sessionId={sessionId} embedded />
        <Button
          variant="primary"
          fullWidth
          onClick={() => {
            clearSession();
            navigate({ screen: 'training' });
          }}
        >
          Вернуться к тренировкам
        </Button>
      </div>
    );
  }

  if (primed && primed.status === 'completed') {
    const { summary, variant } = primed;
    const stats: readonly { label: string; value: string }[] = variant
      ? [
          { label: 'Решено', value: `${summary.attempted} / ${primed.total}` },
          { label: 'Правильно', value: String(summary.correct) },
          { label: 'Неправильно', value: String(summary.incorrect) },
          {
            label: 'Точность',
            value: summary.accuracy !== null ? `${Math.round(summary.accuracy)}%` : '—',
          },
        ]
      : [
          { label: 'Решено', value: String(summary.attempted) },
          { label: 'Правильно', value: String(summary.correct) },
          { label: 'Неправильно', value: String(summary.incorrect) },
          {
            label: 'Точность',
            value: summary.accuracy !== null ? `${Math.round(summary.accuracy)}%` : '—',
          },
          { label: 'Навыков затронуто', value: String(summary.skillsPracticed) },
          { label: 'Новых ошибок', value: String(summary.mistakesCreated) },
        ];
    return (
      <SlideUp className={styles.page}>
        <h1 className="text-h1">
          {variant ? `Вариант ${variant.variantNumber} завершён` : 'Тренировка завершена'}
        </h1>
        <Card className={styles.summaryGrid}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.summaryStat}>
              <span className="text-h2">{stat.value}</span>
              <span className="text-body-sm text-secondary">{stat.label}</span>
            </div>
          ))}
        </Card>
        <Button
          variant="primary"
          fullWidth
          onClick={() => {
            clearSession();
            navigate({ screen: 'training' });
          }}
        >
          Вернуться к тренировкам
        </Button>
      </SlideUp>
    );
  }

  return (
    <SlideUp className={styles.page}>
      <p className="text-body-sm text-secondary">Загрузка тренировки…</p>
    </SlideUp>
  );
}
