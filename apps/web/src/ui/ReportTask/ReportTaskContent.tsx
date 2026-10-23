import { useRef, useState, type FormEvent } from 'react';
import {
  COMPLAINT_COMMENT_MAX,
  complaintReasonLabels,
  offeredComplaintReasons,
  type ComplaintContextInput,
} from '@zybrilka/shared';
import { ApiError, reportTask, type ComplaintReason } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { useOptionalNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import styles from './ReportTaskContent.module.css';

export interface ReportTaskContentProps {
  taskId: string;
  /** Which screen the report comes from; the path is added here. */
  screen?: ComplaintContextInput['screen'];
  variantId?: string;
  /** Closes the surrounding sheet/modal («Закрыть» without sending). */
  onClose?: () => void;
}

type State = 'form' | 'sending' | 'sent' | 'already' | 'error' | 'rate_limited';

/** The app path to store with the report — pathname + search only. */
function currentPath(): string | undefined {
  try {
    const path = `${window.location.pathname}${window.location.search}`;
    return path.length <= 300 && path.startsWith('/') ? path : window.location.pathname;
  } catch {
    return undefined;
  }
}

/**
 * «Сообщить об ошибке» (CLAUDE.md §17): pick what is wrong — that alone is
 * a complete report — and optionally add a few words («Другая причина»
 * needs them). Stores the task id, the screen and path it was sent from;
 * the server adds a snapshot of the task. Needs an account (the server
 * requires a session) — a guest is offered sign-in instead of a form that
 * could not be sent. Embedded in the caller's Modal / BottomSheet.
 */
export function ReportTaskContent({
  taskId,
  screen = 'task',
  variantId,
  onClose,
}: ReportTaskContentProps) {
  const { user } = useAuth();
  const navigation = useOptionalNavigation();
  const [state, setState] = useState<State>('form');
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [comment, setComment] = useState('');
  const [reportId, setReportId] = useState<string | null>(null);
  // A double tap must never send twice, even before React re-renders.
  const inFlight = useRef(false);

  const closeButton = onClose && (
    <Button type="button" variant="secondary" onClick={onClose} fullWidth>
      Закрыть
    </Button>
  );

  if (state === 'sent' || state === 'already') {
    return (
      <div className={styles.form}>
        <p className="text-body-sm" role="status">
          {state === 'sent'
            ? 'Спасибо! Сообщение об ошибке отправлено — мы проверим задание.'
            : 'Вы уже сообщили об этой проблеме — она в работе.'}
          {reportId && <span className={styles.reportId}> Номер обращения: {reportId}.</span>}
        </p>
        {closeButton}
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.form}>
        <p className="text-body-sm text-secondary">
          Чтобы сообщить об ошибке, войдите в аккаунт — так мы защищаемся от спама.
        </p>
        <Button onClick={() => navigation?.navigate({ screen: 'login' })} fullWidth>
          Войти
        </Button>
        {closeButton}
      </div>
    );
  }

  const commentRequired = reason === 'other';
  const trimmed = comment.trim();
  const canSend = reason !== null && (!commentRequired || trimmed.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason || !canSend || inFlight.current) return;
    inFlight.current = true;
    setState('sending');
    try {
      const path = currentPath();
      const result = await reportTask(taskId, reason, trimmed || undefined, {
        screen,
        ...(path ? { path } : {}),
        ...(variantId ? { variantId } : {}),
      });
      setReportId(result.reportId ?? null);
      setState(result.status === 'already_reported' ? 'already' : 'sent');
    } catch (error) {
      setState(error instanceof ApiError && error.status === 429 ? 'rate_limited' : 'error');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.reasons}>
        <legend className={styles.legend}>Что не так с заданием?</legend>
        {offeredComplaintReasons.map((id) => (
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
        {commentRequired ? 'Опишите проблему (обязательно)' : 'Комментарий (необязательно)'}
        <textarea
          className={styles.comment}
          value={comment}
          maxLength={COMPLAINT_COMMENT_MAX}
          rows={3}
          required={commentRequired}
          aria-describedby="complaint-comment-count"
          onChange={(e) => setComment(e.target.value)}
        />
        <span id="complaint-comment-count" className={styles.counter}>
          {comment.length} / {COMPLAINT_COMMENT_MAX}
        </span>
      </label>
      {state === 'error' && (
        <p className={styles.error} role="alert">
          Не удалось отправить. Попробуйте ещё раз.
        </p>
      )}
      {state === 'rate_limited' && (
        <p className={styles.error} role="alert">
          Слишком много сообщений подряд. Попробуйте позже.
        </p>
      )}
      <Button type="submit" disabled={!canSend} loading={state === 'sending'} fullWidth>
        Отправить
      </Button>
      {closeButton}
    </form>
  );
}
