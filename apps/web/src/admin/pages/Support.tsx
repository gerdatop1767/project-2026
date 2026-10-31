import { useEffect, useRef, useState } from 'react';
import type {
  SupportMessageDto,
  SupportThreadDetail,
  SupportThreadSummary,
  SupportUnreachableReason,
  SupportUserSearchItem,
} from '@zybrilka/shared';
import { clsx } from '../../lib/clsx.js';
import { AdminApiError, adminApi, errorText } from '../adminApi.js';
import { PageHead } from '../components/Shell.js';
import { Badge, ErrorState, Note, Segmented, Skeleton } from '../components/ui.js';
import { dateTime } from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';
import css from './Support.module.css';

/** How often open views ask for news (no manual reload needed). */
export const SUPPORT_POLL_MS = 5_000;

type StatusFilter = 'open' | 'closed' | 'all';

const reasonText: Record<SupportUnreachableReason, string> = {
  no_telegram: 'Telegram не привязан к аккаунту — боту некуда писать.',
  not_started: 'Пользователь не запускал бота: Telegram не разрешает боту писать первым.',
  blocked: 'Пользователь заблокировал бота.',
};

const deliveryText: Record<NonNullable<SupportMessageDto['delivery']>, string> = {
  pending: 'в очереди',
  sending: 'отправляется',
  sent: 'доставлено',
  failed: 'не доставлено',
  uncertain: 'статус неизвестен',
};

/** Re-asks every few seconds while the page is visible. */
function usePolling(reload: () => void) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, SUPPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
}

function ThreadList({
  activeId,
  status,
  onStatus,
}: {
  activeId: string | null;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
}) {
  const [q, setQ] = useState('');
  const list = useAdminQuery<{ items: SupportThreadSummary[]; unread: number }>(
    '/support/threads',
    { status, q: q.trim() || undefined },
  );
  usePolling(list.reload);
  const items = list.data?.items ?? [];
  return (
    <div className={css.list}>
      <div className={css.listTools}>
        <Segmented
          label="Статус обращений"
          value={status}
          onChange={onStatus}
          options={[
            { value: 'open', label: 'Открытые' },
            { value: 'closed', label: 'Закрытые' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <input
          type="search"
          className={s.input}
          placeholder="Поиск по имени"
          aria-label="Поиск по имени"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {list.status === 'error' && !list.data && (
        <ErrorState error={list.error} onRetry={list.reload} compact />
      )}
      {!list.data && list.status === 'loading' && <Skeleton height={240} />}
      {list.data && items.length === 0 && <p className={css.empty}>Обращений пока нет.</p>}
      <ul className={css.threads} aria-label="Обращения">
        {items.map((t) => (
          <li key={t.id}>
            <AdminLink
              to={`/admin/support/${t.id}`}
              className={clsx(css.thread, t.id === activeId && css.threadActive)}
              aria-current={t.id === activeId ? 'true' : undefined}
            >
              <span className={css.threadTop}>
                <span className={css.threadName}>{t.name}</span>
                {t.unread && (
                  <span className={css.unread} aria-label="непрочитанное">
                    ●
                  </span>
                )}
              </span>
              <span className={css.threadPreview}>
                {t.lastMessageFrom === 'admin' ? 'Вы: ' : ''}
                {t.lastMessagePreview || '—'}
              </span>
              <span className={css.threadMeta}>
                {dateTime(t.lastMessageAt)}
                {t.status === 'closed' && <Badge>закрыто</Badge>}
              </span>
            </AdminLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({ m }: { m: SupportMessageDto }) {
  return (
    <li className={clsx(css.message, m.direction === 'admin' ? css.fromAdmin : css.fromUser)}>
      {m.text && <p className={css.text}>{m.text}</p>}
      {m.attachments.map((a) =>
        a.kind === 'photo' ? (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer">
            <img src={a.url} alt="Фото от пользователя" className={css.photo} loading="lazy" />
          </a>
        ) : (
          <a key={a.url} href={a.url} className={s.link} target="_blank" rel="noopener noreferrer">
            📎 {a.fileName ?? 'Файл'}
          </a>
        ),
      )}
      <span className={css.messageMeta}>
        {dateTime(m.createdAt)}
        {m.delivery && (
          <span data-delivery={m.delivery}>
            {' · '}
            {deliveryText[m.delivery]}
            {m.deliveryError === 'blocked' ? ' (бот заблокирован)' : ''}
          </span>
        )}
      </span>
    </li>
  );
}

function Conversation({ id }: { id: string }) {
  const detail = useAdminQuery<SupportThreadDetail>(`/support/threads/${id}`);
  usePolling(detail.reload);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const count = detail.data?.messages.length ?? 0;

  // Opened → read (also on new messages while it is open).
  const lastAt = detail.data?.thread.lastMessageAt;
  useEffect(() => {
    if (!lastAt) return;
    adminApi.post(`/support/threads/${id}/read`, {}).catch(() => undefined);
  }, [id, lastAt]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  if (!detail.data) {
    return detail.status === 'error' ? (
      <ErrorState error={detail.error} onRetry={detail.reload} />
    ) : (
      <Skeleton height={320} />
    );
  }
  const { thread, messages } = detail.data;

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await adminApi.post(`/support/threads/${id}/messages`, { text });
      setDraft('');
      detail.reload();
    } catch (e) {
      setError(
        e instanceof AdminApiError && e.code === 'thread_closed'
          ? 'Обращение закрыто — откройте его снова, чтобы ответить.'
          : errorText(e),
      );
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: 'open' | 'closed') {
    setError(null);
    try {
      await adminApi.post(`/support/threads/${id}/status`, { status });
      detail.reload();
    } catch (e) {
      setError(
        e instanceof AdminApiError && e.code === 'another_thread_open'
          ? 'У этого пользователя уже есть открытое обращение.'
          : errorText(e),
      );
    }
  }

  return (
    <section className={css.chat} aria-label={`Переписка: ${thread.name}`}>
      <header className={css.chatHead}>
        <AdminLink to="/admin/support" className={css.back}>
          ← Все обращения
        </AdminLink>
        <div className={css.chatTitle}>
          <h2>{thread.name}</h2>
          <span className={s.small}>
            {thread.status === 'open' ? <Badge tone="good">открыто</Badge> : <Badge>закрыто</Badge>}{' '}
            с {dateTime(thread.createdAt)}
            {thread.userId && (
              <>
                {' · '}
                <AdminLink to={`/admin/users/${thread.userId}`} className={s.link}>
                  карточка пользователя
                </AdminLink>
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          className={s.button}
          onClick={() => void setStatus(thread.status === 'open' ? 'closed' : 'open')}
        >
          {thread.status === 'open' ? 'Закрыть обращение' : 'Открыть снова'}
        </button>
      </header>

      {!thread.reachable && (
        <Note>
          Бот сейчас не может написать этому пользователю (не запускал бота или заблокировал его).
        </Note>
      )}

      <ol className={css.messages} aria-label="Сообщения">
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </ol>
      <div ref={bottom} />

      {thread.status === 'open' ? (
        <form
          className={css.reply}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className={s.textarea}
            aria-label="Ответ пользователю"
            placeholder="Ответ уйдёт пользователю в Telegram"
            value={draft}
            maxLength={4000}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
          />
          <button
            type="submit"
            className={clsx(s.button, s.buttonPrimary)}
            disabled={sending || !draft.trim()}
          >
            {sending ? 'Отправляем…' : 'Отправить'}
          </button>
        </form>
      ) : (
        <p className={css.empty}>Обращение закрыто. Откройте его снова, чтобы ответить.</p>
      )}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function StartConversation({ onClose }: { onClose: () => void }) {
  const { navigate } = useAdminRouter();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<SupportUserSearchItem | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useAdminQuery<{ items: SupportUserSearchItem[] }>(
    q.trim().length >= 2 ? '/support/users' : null,
    { q: q.trim() },
  );

  async function start() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { threadId } = await adminApi.post<{ threadId: string }>('/support/start', {
        userId: picked.userId,
        text: text.trim(),
      });
      onClose();
      navigate(`/admin/support/${threadId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={css.start} aria-label="Написать пользователю">
      <div className={css.startHead}>
        <h2 className={s.cardTitle}>Написать пользователю</h2>
        <button type="button" className={s.button} onClick={onClose}>
          Отмена
        </button>
      </div>
      <p className={s.small}>
        Только одному человеку и только если он запускал бота — Telegram не разрешает ботам писать
        первыми. Для сообщений всем — раздел «Рассылки».
      </p>
      <input
        type="search"
        className={s.input}
        placeholder="Имя или ID пользователя"
        aria-label="Найти пользователя"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPicked(null);
        }}
      />
      {search.data && search.data.items.length === 0 && (
        <p className={css.empty}>Никого не нашли.</p>
      )}
      <ul className={css.found}>
        {search.data?.items.map((u) => (
          <li key={u.userId}>
            <button
              type="button"
              className={clsx(css.foundUser, picked?.userId === u.userId && css.threadActive)}
              aria-pressed={picked?.userId === u.userId}
              onClick={() => setPicked(u)}
            >
              <span>{u.name}</span>
              {u.reachable ? (
                <Badge tone="good">можно написать</Badge>
              ) : (
                <span className={s.small}>{reasonText[u.reason!]}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {picked && picked.reachable && (
        <>
          {picked.openThreadId && (
            <Note>У пользователя уже есть открытое обращение — сообщение попадёт в него.</Note>
          )}
          <textarea
            className={s.textarea}
            aria-label="Первое сообщение"
            rows={3}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className={clsx(s.button, s.buttonPrimary)}
            disabled={busy || !text.trim()}
            onClick={() => void start()}
          >
            Отправить
          </button>
        </>
      )}
      {picked && !picked.reachable && (
        <p className={css.error} role="alert">
          {reasonText[picked.reason!]}
        </p>
      )}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * «Поддержка» (docs/SUPPORT.md): conversations with users through the bot.
 * Two columns on a wide screen (list | conversation); on a phone the list
 * opens a conversation and «← Все обращения» goes back. New messages
 * appear by themselves (polled every few seconds).
 */
export function SupportPage({ id }: Record<string, string | undefined>) {
  const { location, setParams } = useAdminRouter();
  const status = (location.params.get('status') as StatusFilter | null) ?? 'open';
  const [starting, setStarting] = useState(false);
  return (
    <>
      <PageHead
        title="Поддержка"
        subtitle={<p className={s.subtitle}>Переписка с пользователями через Telegram-бота</p>}
        actions={
          <button type="button" className={s.button} onClick={() => setStarting(true)}>
            Написать первым
          </button>
        }
      />
      {starting && <StartConversation onClose={() => setStarting(false)} />}
      <div className={clsx(css.layout, id && css.hasConversation)}>
        <ThreadList
          activeId={id ?? null}
          status={status}
          onStatus={(value) => setParams({ status: value === 'open' ? null : value })}
        />
        <div className={css.pane}>
          {id ? (
            <Conversation key={id} id={id} />
          ) : (
            <p className={css.placeholder}>Выберите обращение слева.</p>
          )}
        </div>
      </div>
    </>
  );
}

export function SupportThreadPage({ id = '' }: Record<string, string>) {
  return <SupportPage id={id} />;
}
