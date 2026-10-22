import { useState, type FormEvent } from 'react';
import { ApiError, reportTask, type ComplaintReason } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { useOptionalNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import styles from './ReportTaskContent.module.css';

export interface ReportTaskContentProps {
  taskId: string;
}

export const complaintReasonLabels: Record<ComplaintReason, string> = {
  wrong_answer: 'Неверный ответ',
  condition_error: 'Ошибка в условии',
  typo: 'Опечатка',
  bad_explanation: 'Неверное или непонятное решение',
  display_problem: 'Проблема с отображением',
  other: 'Другое',
};

type State = 'closed' | 'form' | 'sending' | 'sent' | 'already' | 'error' | 'rate_limited';

/**
 * «Пожаловаться на задание» (CLAUDE.md §17): a reason, an optional
 * comment, sent to the server, which stores it for the owner's admin
 * panel. Needs an account (the server requires a session) — a guest is
 * told so and offered sign-in instead of a form that could not be sent.
 * Embedded in whichever container the caller uses (Modal / BottomSheet).
 */
export function ReportTaskContent({ taskId }: ReportTaskContentProps) {
  const { user } = useAuth();
  const navigation = useOptionalNavigation();
  const [state, setState] = useState<State>('closed');
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [comment, setComment] = useState('');

  if (state === 'sent' || state === 'already') {
    return (
      <p className="text-body-sm text-secondary" role="status">
        {state === 'sent'
          ? 'Спасибо! Жалоба отправлена — мы проверим задание.'
          : 'Вы уже сообщили об этой проблеме — она в работе.'}
      </p>
    );
  }

  if (state === 'closed') {
    return (
      <button type="button" className={styles.action} onClick={() => setState('form')}>
        <Icon name="warning" size={18} />
        Пожаловаться на задание
      </button>
    );
  }

  if (!user) {
    return (
      <div className={styles.form}>
        <p className="text-body-sm text-secondary">
          Чтобы отправить жалобу, войдите в аккаунт — так мы защищаемся от спама.
        </p>
        <Button onClick={() => navigation?.navigate({ screen: 'login' })} fullWidth>
          Войти
        </Button>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setState('sending');
    try {
      const result = await reportTask(taskId, reason, comment.trim() || undefined);
      setState(result.status === 'already_reported' ? 'already' : 'sent');
    } catch (error) {
      setState(error instanceof ApiError && error.status === 429 ? 'rate_limited' : 'error');
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.reasons}>
        <legend className={styles.legend}>Что не так?</legend>
        {(Object.keys(complaintReasonLabels) as ComplaintReason[]).map((id) => (
          <label key={id} className={styles.reason}>
            <input
              type="radio"
              name="complaint-reason"
              value={id}
              checked={reason === id}
              onChange={() => setReason(id)}
            />
            {complaintReasonLabels[id]}
          </label>
        ))}
      </fieldset>
      <label className={styles.commentLabel}>
        Комментарий (необязательно)
        <textarea
          className={styles.comment}
          value={comment}
          maxLength={1000}
          rows={3}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      {state === 'error' && (
        <p className={styles.error} role="alert">
          Не удалось отправить. Попробуйте ещё раз.
        </p>
      )}
      {state === 'rate_limited' && (
        <p className={styles.error} role="alert">
          Слишком много жалоб подряд. Попробуйте позже.
        </p>
      )}
      <Button type="submit" disabled={!reason} loading={state === 'sending'} fullWidth>
        Отправить жалобу
      </Button>
    </form>
  );
}
