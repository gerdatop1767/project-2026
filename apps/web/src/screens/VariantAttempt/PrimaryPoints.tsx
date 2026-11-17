import {
  TARGET_EXAM_YEAR,
  type TaskScoreStatus,
  type VariantAttemptScoring,
} from '@zybrilka/shared';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import styles from './VariantAttempt.module.css';

const statusLabel: Record<TaskScoreStatus, string> = {
  full: 'Полный балл',
  partial: 'Частично',
  zero: 'Неверно',
  unanswered: 'Нет ответа',
  not_graded: 'Не оценивается',
};

/**
 * «Баллы ЕГЭ» of one variant attempt. The ЕГЭ result is the TEST score
 * (0–100) by the table stored with the attempt, shown large with its
 * label («Тестовый балл · ориентир по шкале ЕГЭ-2026»); primary points
 * are shown apart and named as primary. Without a fitting table only
 * primary points are shown, with the reason. Then the part split and a
 * per-task breakdown; what is an estimate is said plainly.
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
  const essay = s.notGradedMax > 0;
  const estimated = s.tasks.some((t) => t.estimated);
  return (
    <Card className={styles.score} aria-labelledby="points-title">
      <div className={styles.pointsHead}>
        <h2 id="points-title" className={styles.sectionTitle}>
          Баллы ЕГЭ
        </h2>
        {s.preliminary && <span className={styles.badge}>Предварительно</span>}
      </div>
      {s.conversion.available ? (
        <>
          <p className={styles.scoreMain}>
            <span className={styles.scoreValue}>{s.conversion.testScore}</span>
            <span className="text-body text-secondary"> тестовых баллов из 100</span>
          </p>
          <p className={styles.scaleLabel}>{s.conversion.label}</p>
          <p className="text-body-sm text-secondary">
            Первичные баллы: {s.primary} из {s.examMaxTotal}
            {essay ? ` (без сочинения — до ${s.notGradedMax} баллов)` : ''}.
          </p>
        </>
      ) : (
        <>
          <p className={styles.scoreMain}>
            <span className={styles.scoreValue}>{s.primary}</span>
            <span className="text-body text-secondary"> из {s.examMaxTotal} первичных</span>
          </p>
          <p className="text-body-sm text-secondary">
            Это первичные баллы, а не тестовые (0–100). Тестовый балл не считается: причина ниже.
          </p>
        </>
      )}
      <dl className={styles.scoreGrid}>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">Часть 1</dt>
          <dd className={styles.statValue}>
            {s.partOne.awarded} / {s.partOne.max}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">
            {essay ? 'Сочинение, не оценивается' : 'Часть 2, по ответу'}
          </dt>
          <dd className={styles.statValue}>
            {essay ? `— / ${s.partTwo.max}` : `${s.partTwo.awarded} / ${s.partTwo.max}`}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className="text-body-sm text-secondary">Тестовый балл (0–100)</dt>
          <dd className={styles.statValue}>
            {s.conversion.available ? s.conversion.testScore : '—'}
          </dd>
        </div>
      </dl>

      <ul className={styles.pointsNotes}>
        {s.conversion.available ? (
          s.conversion.status === 'approximate' ? (
            <li>
              Оценка приблизительная, официальная шкала может отличаться. Шкала:{' '}
              {s.conversion.source}.
            </li>
          ) : (
            s.conversion.examYear < TARGET_EXAM_YEAR && (
              <li>
                Шкалу ЕГЭ-{TARGET_EXAM_YEAR} утвердят только после экзамена, поэтому тестовый балл
                посчитан по официальной шкале ЕГЭ-{s.conversion.examYear} — как ориентир.
                <details className={styles.scaleSource}>
                  <summary>Источник шкалы</summary>
                  {s.conversion.source}.
                </details>
              </li>
            )
          )
        ) : (
          <li>{s.conversion.reason}</li>
        )}
        {essay && (
          <li>
            Сочинение (до {s.notGradedMax} первичных баллов) проверяют эксперты, приложение его не
            оценивает: баллы и тестовый балл посчитаны без него.
          </li>
        )}
        {s.preliminary && <li>Вариант не завершён — баллы могут измениться.</li>}
        {missing.length > 0 && (
          <li>
            {missing.length === 1 ? 'Задание' : 'Задания'} №{missing.join(', №')}{' '}
            {missing.length === 1 ? 'сейчас на проверке и не входит' : 'сейчас не входят'} в
            вариант: доступно {s.maxAvailable} из {s.examMaxTotal} баллов.
          </li>
        )}
        {estimated && (
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
        )}
        {s.rulesStatus === 'project' && (
          <li>
            Баллы — по проекту КИМ ЕГЭ {s.format.slice(-4)} (ФИПИ, август 2026), по которому
            составлен этот сборник (старая редакция). В окончательной редакции ЕГЭ-2027 19 заданий и
            32 балла, как в 2026 году.
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
                {t.status === 'not_graded' ? `— из ${t.max}` : `${t.awarded} из ${t.max}`}
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
