import { useEffect, useState } from 'react';
import { DIFFICULTY_BAND_LABELS, type DifficultyRatingResponse } from '@zybrilka/shared';
import { getDifficultyRating, rateTaskDifficulty } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import styles from './LearningEngine.module.css';

/**
 * «Насколько сложным было это задание?» — optional, after the answer was
 * checked (docs/learning/ALGORITHMS.md § 5). A row of 1–10; tapping again
 * changes the rating; nothing has to be chosen. Shows the community value
 * only from 5 ratings. Signed-in students only.
 */
export function DifficultyRating({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<DifficultyRatingResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    getDifficultyRating(taskId).then(
      (d) => live && setData(d),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [user, taskId]);

  if (!user) return null;

  async function rate(value: number) {
    setSaving(true);
    setFailed(false);
    try {
      setData(await rateTaskDifficulty(taskId, value));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const mine = data?.myRating ?? null;
  const community = data?.community;
  return (
    <section className={styles.rating} aria-labelledby={`rating-${taskId}`}>
      <p id={`rating-${taskId}`} className="text-body-sm" style={{ fontWeight: 600 }}>
        Насколько сложным было это задание?
      </p>
      <div className={styles.scale} role="radiogroup" aria-label="Сложность от 1 до 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mine === v}
            aria-label={`${v} из 10`}
            disabled={saving}
            className={clsx(styles.scaleItem, mine === v && styles.scaleItemOn)}
            onClick={() => void rate(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <p className={clsx('text-secondary', styles.scaleLegend)}>
        <span>1 — очень легко</span>
        <span>10 — крайне сложно</span>
      </p>
      {failed && (
        <p className="text-body-sm" role="alert">
          Не удалось сохранить оценку. Попробуй ещё раз.
        </p>
      )}
      {mine !== null && community && (
        <p className="text-body-sm text-secondary" aria-live="polite">
          Твоя оценка: {mine}.{' '}
          {community.confident && community.median !== null && community.band
            ? `Ученики оценивают задание как ${DIFFICULTY_BAND_LABELS[community.band]}: ${String(community.median).replace('.', ',')} из 10 (${community.count} оценок).`
            : 'Общая оценка появится, когда задание оценят хотя бы 5 учеников.'}
        </p>
      )}
    </section>
  );
}
