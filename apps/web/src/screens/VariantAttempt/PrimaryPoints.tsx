import type { TaskScoreStatus, VariantAttemptScoring } from '@zybrilka/shared';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import styles from './VariantAttempt.module.css';

const statusLabel: Record<TaskScoreStatus, string> = {
  full: 'Полный балл',
  partial: 'Частично',
  zero: 'Неверно',
  unanswered: 'Нет ответа',
};

/**
 * «Первичные баллы ЕГЭ» of one variant attempt: primary points from the attempt's
 * frozen rules, the part split, the conversion to a test score only when
 * a confirmed scale exists (otherwise why not), and a per-task
 * breakdown. Says plainly what is an estimate.
 */
export function PrimaryPoints({
  scoring: s,
  onReviewMistakes,
}: {
  scoring: VariantAttemptScoring;
  /** Null when there is nothing to go over. */
  onReviewMistakes: (() => void) | null;
}) {
  const missing = s.unavailableTaskNumbers;
  return (
    <Card className={styles.score} aria-labelledby="points-title">
      <div className={styles.pointsHead}>
        <h2 id="points-title" className={styles.sectionTitle}>
          Первичные баллы ЕГЭ
        </h2>
        {s.preliminary && <span className={styles.badge}>Предварительно</span>}
      </div>
      <p className={styles.scoreMain}>
        <span className={styles.scoreValue}>{s.primary}</span>
        <span className="text-body text-secondary"> из {s.examMaxTotal}</span>
      </p>
      <p className="text-body-sm text-secondary">Первичные баллы — не тестовые (0–100)</p>
      <dl className={styles.scoreGrid}>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">Часть 1</dt>
          <dd className={styles.statValue}>
            {s.partOne.awarded} / {s.partOne.max}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">Часть 2, по ответу</dt>
          <dd className={styles.statValue}>
            {s.partTwo.awarded} / {s.partTwo.max}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">Тестовый балл (0–100)</dt>
          <dd className={styles.statValue}>
            {s.conversion.available ? `≈ ${s.conversion.testScore}` : '—'}
          </dd>
        </div>
      </dl>

      <ul className={styles.pointsNotes}>
        {s.conversion.available ? (
          s.conversion.status === 'approximate' && (
            <li>
              Оценка приблизительная, официальная шкала может отличаться. Шкала:{' '}
              {s.conversion.source}.
            </li>
          )
        ) : (
          <li>{s.conversion.reason}</li>
        )}
        {s.preliminary && <li>Вариант не завершён — баллы могут измениться.</li>}
        {missing.length > 0 && (
          <li>
            {missing.length === 1 ? 'Задание' : 'Задания'} №{missing.join(', №')}{' '}
            {missing.length === 1 ? 'сейчас на проверке и не входит' : 'сейчас не входят'} в
            вариант: доступно {s.maxAvailable} из {s.examMaxTotal} баллов.
          </li>
        )}
        <li>
          Часть 2 оценена только по ответу: решение и доказательство здесь не проверяются, поэтому
          балл за неё ориентировочный — это наши правила, а не официальные критерии.
          {partTwoRules(s).map((r) => (
            <span key={r.note} className={styles.pointsRule}>
              {' '}
              №{r.numbers.join(', №')}: {r.note}
            </span>
          ))}
        </li>
        {s.rulesStatus === 'project' && (
          <li>
            Максимальные баллы — по проекту КИМ ЕГЭ {s.format.slice(-4)} (ФИПИ); в окончательной
            версии они могут измениться.
          </li>
        )}
        {s.rulesSource === 'current' && (
          <li>Попытка начата до подсчёта баллов — посчитано по действующим правилам.</li>
        )}
      </ul>

      <table className={styles.breakdown} aria-label="Баллы по заданиям">
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Результат</th>
            <th scope="col">Балл</th>
          </tr>
        </thead>
        <tbody>
          {s.tasks.map((t) => (
            <tr key={t.taskId} data-status={t.status}>
              <th scope="row">{t.taskNumber}</th>
              <td>{statusLabel[t.status]}</td>
              <td className={styles.breakdownPoints}>
                {t.awarded} из {t.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {onReviewMistakes && (
        <Button variant="secondary" onClick={onReviewMistakes} fullWidth>
          <Icon name="errorCircle" size={18} /> Разобрать ошибки
        </Button>
      )}
    </Card>
  );
}

/** Distinct Part 2 rule notes, each with the task numbers it applies to. */
function partTwoRules(s: VariantAttemptScoring): { note: string; numbers: number[] }[] {
  const byNote = new Map<string, number[]>();
  for (const t of s.tasks) {
    if (!t.estimated || !t.note) continue;
    byNote.set(t.note, [...(byNote.get(t.note) ?? []), t.taskNumber]);
  }
  return [...byNote].map(([note, numbers]) => ({ note, numbers }));
}
