import { useEffect, useState } from 'react';
import type { RecommendationWithTasks } from '@zybrilka/shared';
import { getLearningRecommendations, startLearningSession } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import {
  applyLearningSessionResponse,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import { Skeleton } from '../Skeleton/Skeleton.js';
import styles from './LearningEngine.module.css';

function tasksLabel(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word =
    m10 === 1 && m100 !== 11
      ? 'задание'
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
        ? 'задания'
        : 'заданий';
  return `${n} ${word}`;
}

const SUBJECT_NAMES: Record<string, string> = { math: 'Математика', russian: 'Русский язык' };

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: readonly RecommendationWithTasks[] };

/**
 * «Рекомендации для тебя» (Learning Engine, docs/learning/API.md): concrete
 * numbers with the student's own reason, the benefit and «Начать» — a
 * training of exactly that number. Nothing is invented on the client: an
 * empty list says so, a guest is asked to sign in.
 */
export function RecommendationsList({
  subjectId,
  limit = 4,
}: {
  subjectId?: string;
  limit?: number;
}) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { setSession } = useLearningSessionContext();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setState({ status: 'loading' });
    getLearningRecommendations({ subjectId, limit }).then(
      (r) => live && setState({ status: 'ready', items: r.recommendations }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [user, subjectId, limit, attempt]);

  if (user === null) {
    return (
      <p className="text-body-sm text-secondary">
        Войди, чтобы получать рекомендации по своим ошибкам и слабым номерам.
      </p>
    );
  }
  if (user === undefined || state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Рекомендации загружаются" className={styles.list}>
        <Skeleton height={88} />
        <Skeleton height={88} />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className={styles.empty}>
        <p className="text-body-sm">Не удалось загрузить рекомендации.</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </Button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return (
      <p className="text-body-sm text-secondary" role="status">
        Пока нечего рекомендовать: реши несколько заданий — и здесь появятся номера, которые стоит
        повторить.
      </p>
    );
  }

  async function start(r: RecommendationWithTasks) {
    setStarting(r.skillKey);
    try {
      const response = await startLearningSession({
        subjectId: r.subjectId,
        limit: Math.min(10, Math.max(r.suggestedTasks, r.taskIds.length)),
        focusSkill: r.skillKey,
      });
      applyLearningSessionResponse(response, setSession, navigate);
    } catch {
      setState({ status: 'error' });
    } finally {
      setStarting(null);
    }
  }

  return (
    <ul className={styles.list} aria-label="Рекомендации">
      {state.items.map((r) => (
        <li key={r.skillKey} className={styles.rec}>
          <div className={styles.recHead}>
            <span className={styles.number}>{r.examNumber ? `№${r.examNumber}` : '—'}</span>
            <span className={styles.recTitle}>
              <span className="text-body" style={{ fontWeight: 700 }}>
                {r.title}
              </span>
              <span className="text-label text-secondary">{SUBJECT_NAMES[r.subjectId]}</span>
            </span>
          </div>
          <p className="text-body-sm">{r.reason}</p>
          <p className="text-label text-secondary">{r.benefit}</p>
          <Button
            variant="secondary"
            loading={starting === r.skillKey}
            disabled={starting !== null}
            onClick={() => void start(r)}
          >
            Начать · {tasksLabel(Math.min(10, Math.max(r.suggestedTasks, r.taskIds.length)))}
          </Button>
        </li>
      ))}
    </ul>
  );
}
