import { useId, useRef, useState, type FormEvent } from 'react';
import {
  COMPLAINT_COMMENT_MAX,
  complaintReasonHints,
  complaintReasonLabels,
  offeredComplaintReasons,
  type ComplaintContextInput,
} from '@zybrilka/shared';
import { ApiError, reportTask, type ComplaintReason } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { useOptionalNavigation } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import styles from './ReportTaskContent.module.css';

/** The surrounding Modal / BottomSheet: header and footer stay, the list scrolls. */
export const reportPanelClassName = styles.panel;

/** Shared title / subtitle / icon for the surrounding Modal / BottomSheet. */
export const reportDialogHeader = {
  title: 'Сообщить об ошибке',
  subtitle: 'Помогите нам делать задания лучше',
  icon: 'warning',
} as const satisfies { title: string; subtitle: string; icon: IconName };

const reasonIcons: Record<(typeof offeredComplaintReasons)[number], IconName> = {
  wrong_answer: 'checklist',
  condition_error: 'variant',
  bad_explanation: 'hint',
  display_problem: 'image',
  answer_check: 'link',
  wrong_topic: 'tag',
  duplicate: 'copy',
  other: 'more',
};

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
  const idPrefix = useId();

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
    <form className={clsx(styles.form, styles.formLayout)} onSubmit={submit}>
      <div className={styles.body}>
        <fieldset className={styles.reasons}>
          <legend className={styles.legend}>Что не так с заданием?</legend>
          {offeredComplaintReasons.map((id) => {
            const titleId = `${idPrefix}-${id}-title`;
            const hintId = `${idPrefix}-${id}-hint`;
            return (
              <label
                key={id}
                className={clsx(styles.reason, reason === id && styles.reasonSelected)}
              >
                <input
                  className={styles.radio}
                  type="radio"
                  name="complaint-reason"
                  value={id}
                  checked={reason === id}
                  aria-labelledby={titleId}
                  aria-describedby={hintId}
                  onChange={() => setReason(id)}
                />
                <span className={styles.reasonIcon} aria-hidden="true">
                  <Icon name={reasonIcons[id]} size={20} />
                </span>
                <span className={styles.reasonText}>
                  <span id={titleId} className={styles.reasonTitle}>
                    {complaintReasonLabels[id]}
                  </span>
                  <span id={hintId} className={styles.reasonHint}>
                    {complaintReasonHints[id]}
                  </span>
                </span>
                <span className={styles.indicator} aria-hidden="true" />
              </label>
            );
          })}
        </fieldset>
        <div className={styles.commentBlock}>
          <label htmlFor={`${idPrefix}-comment`} className={styles.commentLabel}>
            {commentRequired ? 'Опишите проблему (обязательно)' : 'Комментарий (необязательно)'}
          </label>
          <textarea
            id={`${idPrefix}-comment`}
            className={styles.comment}
            value={comment}
            maxLength={COMPLAINT_COMMENT_MAX}
            rows={3}
            required={commentRequired}
            placeholder="Опишите подробнее, в чём проблема…"
            aria-describedby={`${idPrefix}-count`}
            onChange={(e) => setComment(e.target.value)}
          />
          <span id={`${idPrefix}-count`} className={styles.counter}>
            {comment.length} / {COMPLAINT_COMMENT_MAX}
          </span>
        </div>
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
      </div>
      <div className={styles.footer}>
        {onClose && (
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        )}
        <Button type="submit" disabled={!canSend} loading={state === 'sending'}>
          <Icon name="send" size={18} />
          Отправить
        </Button>
      </div>
    </form>
  );
}
