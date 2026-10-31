import { useEffect, useState, type ReactNode } from 'react';
import {
  BROADCAST_IMAGE_MAX_BYTES,
  BROADCAST_MAX_IMAGES,
  parseTelegramHtml,
  TELEGRAM_CAPTION_MAX,
  TELEGRAM_TEXT_MAX,
  type BroadcastMediaMode,
  type BroadcastPart,
  type TelegramHtmlNode,
} from '@zybrilka/shared';
import { PageHead } from '../components/Shell.js';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Kpi,
  Note,
  QueryView,
  type Column,
} from '../components/ui.js';
import { AdminApiError, adminApi } from '../adminApi.js';
import { type WorkerStatusInfo } from '../components/WorkerStatus.js';
import { dateTime, num } from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type Status =
  | 'draft'
  | 'awaiting_confirmation'
  | 'sending'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled';

interface Broadcast {
  id: string;
  status: Status;
  text: string;
  mediaMode: BroadcastMediaMode;
  createdAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  recipientsTotal: number | null;
  sentCount: number;
  failedCount: number;
  blockedCount: number;
  testStatus: 'pending' | 'sent' | 'failed' | 'no_recipients' | null;
}

interface Attachment {
  id: string;
  position: number;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

interface Detail {
  broadcast: Broadcast;
  attachments: Attachment[];
  validation: { ok: true; parts: BroadcastPart[] } | { ok: false; error: string };
  recipientsEstimate: number;
  deliveries: {
    status: string;
    errorCode: string | null;
    errorDetail?: string | null;
    n: number;
  }[];
  worker: WorkerStatusInfo | null;
}

type ListItem = Omit<Broadcast, 'mediaMode' | 'testStatus' | 'confirmedAt' | 'startedAt'> & {
  attachments: number;
};

const statusText: Record<Status, string> = {
  draft: 'Черновик',
  awaiting_confirmation: 'Ожидает подтверждения',
  sending: 'Отправляется',
  completed: 'Завершена',
  completed_with_errors: 'Завершена с ошибками',
  cancelled: 'Отменена',
};
const statusTone: Record<Status, 'neutral' | 'warn' | 'info' | 'good' | 'bad'> = {
  draft: 'neutral',
  awaiting_confirmation: 'warn',
  sending: 'info',
  completed: 'good',
  completed_with_errors: 'bad',
  cancelled: 'neutral',
};
const deliveryText: Record<string, string> = {
  pending: 'ждут отправки',
  in_flight: 'отправляются',
  sent: 'доставлено',
  blocked: 'бот заблокирован',
  failed: 'ошибка',
};
const errorCodeText: Record<string, string> = {
  interrupted: 'прервано перезапуском (не повторялось, чтобы не было дублей)',
  partial: 'дошла только часть сообщения',
  rejected: 'Telegram отклонил',
  network: 'сеть / Telegram недоступен (сообщение не ушло)',
  network_uncertain:
    'связь оборвалась после отправки — могло дойти; повторно не отправлялось, чтобы не было дубля',
  rate_limited: 'лимит Telegram',
  content: 'содержимое не прошло проверку',
  unexpected: 'неожиданная ошибка',
  blocked: 'пользователь заблокировал бота',
};

function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={statusTone[status]}>{statusText[status]}</Badge>;
}

const attachmentUrl = (broadcastId: string, attachmentId: string) =>
  `/api/v1/admin/broadcasts/${broadcastId}/attachments/${attachmentId}`;

// ── Preview ─────────────────────────────────────────────────────────────

function renderNodes(nodes: TelegramHtmlNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.text;
    const children = renderNodes(node.children);
    switch (node.tag) {
      case 'b':
      case 'strong':
        return <strong key={i}>{children}</strong>;
      case 'i':
      case 'em':
        return <em key={i}>{children}</em>;
      case 'u':
      case 'ins':
        return <u key={i}>{children}</u>;
      case 's':
      case 'strike':
      case 'del':
        return <s key={i}>{children}</s>;
      case 'code':
        return <code key={i}>{children}</code>;
      case 'pre':
        return <pre key={i}>{children}</pre>;
      case 'blockquote':
        return <blockquote key={i}>{children}</blockquote>;
      case 'tg-spoiler':
        return (
          <span key={i} className={s.spoiler} title="Скрытый текст (спойлер)">
            {children}
          </span>
        );
      case 'a':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" className={s.link}>
            {children}
          </a>
        );
      default:
        return <span key={i}>{children}</span>;
    }
  });
}

/** Roughly what a subscriber sees in Telegram, built from the same parse the
 * worker sends — the formatting here is the formatting there. */
function TelegramPreview({
  broadcastId,
  text,
  attachments,
  parts,
}: {
  broadcastId: string;
  text: string;
  attachments: Attachment[];
  parts: BroadcastPart[] | null;
}) {
  const parsed = parseTelegramHtml(text);
  const body = parsed.ok ? renderNodes(parsed.nodes) : null;
  const media = attachments.length > 0 && (
    <div className={s.previewMedia} data-count={Math.min(attachments.length, 4)}>
      {attachments.map((a) => (
        <img
          key={a.id}
          src={attachmentUrl(broadcastId, a.id)}
          alt={`Изображение ${a.position}`}
          loading="lazy"
        />
      ))}
    </div>
  );
  const separate = parts?.length === 2;
  return (
    <div className={s.tgChat} aria-label="Предпросмотр сообщения">
      <div className={s.tgBubble}>
        {media}
        {!separate && body && body.length > 0 && <div className={s.tgText}>{body}</div>}
      </div>
      {separate && body && (
        <div className={s.tgBubble}>
          <div className={s.tgText}>{body}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Why a broadcast would reach nobody. The audience is the chats that
 * pressed /start, and the bot only learns about a /start while the worker
 * reads its messages (TELEGRAM_BOT_POLLING) — so with that off the
 * audience stays empty however many people use the bot.
 */
function AudienceNote({
  recipients,
  worker,
}: {
  recipients: number;
  worker: WorkerStatusInfo | null;
}) {
  if (recipients > 0) return null;
  let text: string;
  if (!worker || worker.stale) {
    text =
      'Получателей 0, и фоновый процесс (worker) не работает — отправлять сейчас некому и нечем.';
  } else if (!worker.polling) {
    text =
      'Получателей 0: бот сейчас не принимает сообщения (TELEGRAM_BOT_POLLING выключен), поэтому ни один /start не записан. Подписчики появятся, когда приём включат и люди нажмут /start. «Отправить себе» работает и без этого.';
  } else {
    text = 'Получателей 0: ещё никто не нажал /start в боте после включения приёма сообщений.';
  }
  return (
    <p className={s.small} role="alert">
      {text}
    </p>
  );
}

// ── List ────────────────────────────────────────────────────────────────

export function BroadcastsPage() {
  const query = useAdminQuery<{
    items: ListItem[];
    recipientsEstimate: number;
    worker: WorkerStatusInfo | null;
  }>('/broadcasts');
  const { navigate } = useAdminRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.post<Detail>('/broadcasts', { text: '' });
      navigate(`/admin/broadcasts/${created.broadcast.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const columns: Column<ListItem>[] = [
    {
      key: 'createdAt',
      label: 'Создана',
      render: (r) => (
        <AdminLink to={`/admin/broadcasts/${r.id}`} className={s.link}>
          {dateTime(r.createdAt)}
        </AdminLink>
      ),
    },
    { key: 'status', label: 'Статус', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'text',
      label: 'Текст',
      render: (r) =>
        r.text ? (
          <span className={s.small}>
            {r.text.slice(0, 80)}
            {r.text.length > 80 ? '…' : ''}
          </span>
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    { key: 'attachments', label: 'Фото', numeric: true },
    {
      key: 'recipientsTotal',
      label: 'Получателей',
      numeric: true,
      render: (r) => (r.recipientsTotal === null ? '—' : num(r.recipientsTotal)),
    },
    { key: 'sentCount', label: 'Доставлено', numeric: true },
    {
      key: 'failedCount',
      label: 'Ошибки',
      numeric: true,
      render: (r) => num(r.failedCount + r.blockedCount),
    },
  ];

  return (
    <>
      <PageHead
        title="Рассылки"
        actions={
          <button
            type="button"
            className={`${s.button} ${s.buttonPrimary}`}
            disabled={busy}
            onClick={() => void create()}
          >
            Новая рассылка
          </button>
        }
      />
      <div className={s.grid}>
        <Note>
          Сообщение через Telegram-бота получат только те, кто сам запускал бота и не заблокировал
          его. Отправка начинается только после отдельного подтверждения.
        </Note>
        {error !== null && <ErrorState error={error} compact />}
        {query.data && (
          <AudienceNote recipients={query.data.recipientsEstimate} worker={query.data.worker} />
        )}
        <QueryView
          query={query}
          skeleton={300}
          isEmpty={(d) => d.items.length === 0}
          empty="Рассылок пока не было. Нажмите «Новая рассылка», чтобы создать черновик."
        >
          {(d) => (
            <>
              <div className={s.kpis}>
                <Kpi label="Подписчиков бота сейчас" value={d.recipientsEstimate} />
              </div>
              <Card>
                <DataTable
                  caption="Рассылки"
                  columns={columns}
                  rows={d.items}
                  rowKey={(r) => r.id}
                />
              </Card>
            </>
          )}
        </QueryView>
      </div>
    </>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────

function Editor({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const b = detail.broadcast;
  const [text, setText] = useState(b.text);
  const [mode, setMode] = useState<BroadcastMediaMode>(b.mediaMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const dirty = text !== b.text || mode !== b.mediaMode;
  const parsed = parseTelegramHtml(text);
  const limit =
    detail.attachments.length > 0 && mode === 'caption' ? TELEGRAM_CAPTION_MAX : TELEGRAM_TEXT_MAX;

  const run = async (name: string, job: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    setSaved(false);
    try {
      await job();
      onChanged();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = () => adminApi.patch(`/broadcasts/${b.id}`, { text, mediaMode: mode });

  const upload = async (files: FileList | null) => {
    if (!files) return;
    await run('upload', async () => {
      // One after another: the order the files were picked is the order sent.
      for (const file of Array.from(files)) {
        if (file.size > BROADCAST_IMAGE_MAX_BYTES) throw new AdminApiError(413, 'too_large');
        await adminApi.upload(`/broadcasts/${b.id}/attachments`, file);
      }
    }).catch(() => undefined);
  };

  return (
    <Card title="Сообщение" note="Черновик сохраняется только кнопкой «Сохранить черновик»">
      <form
        className={s.grid}
        onSubmit={(e) => {
          e.preventDefault();
          void run('save', save).then((ok) => ok && setSaved(true));
        }}
      >
        <label className={s.field}>
          Текст
          <textarea
            className={s.textarea}
            rows={8}
            value={text}
            maxLength={20_000}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="broadcast-text-help"
          />
        </label>
        <p id="broadcast-text-help" className={s.small}>
          Переносы строк сохраняются. Форматирование Telegram: &lt;b&gt;жирный&lt;/b&gt;,
          &lt;i&gt;курсив&lt;/i&gt;, &lt;u&gt;, &lt;s&gt;, &lt;a
          href="https://…"&gt;ссылка&lt;/a&gt;, &lt;code&gt;, &lt;blockquote&gt;,
          &lt;tg-spoiler&gt;. Символов: {parsed.ok ? parsed.visibleLength : '—'} / {limit}
        </p>
        {!parsed.ok && (
          <p role="alert" className={s.small}>
            {parsed.error}
          </p>
        )}
        <fieldset className={s.filters}>
          <legend className={s.small}>Если есть изображения</legend>
          <label className={s.switchLabel}>
            <input
              type="radio"
              name="media-mode"
              checked={mode === 'caption'}
              onChange={() => setMode('caption')}
            />
            Текст подписью к изображению (до {TELEGRAM_CAPTION_MAX} символов)
          </label>
          <label className={s.switchLabel}>
            <input
              type="radio"
              name="media-mode"
              checked={mode === 'separate'}
              onChange={() => setMode('separate')}
            />
            Изображения, затем текст отдельным сообщением
          </label>
        </fieldset>
        <div className={s.toolbar}>
          <button
            type="submit"
            className={`${s.button} ${s.buttonPrimary}`}
            disabled={!dirty || busy !== null}
          >
            Сохранить черновик
          </button>
          {saved && (
            <span role="status" className={s.small}>
              Сохранено
            </span>
          )}
        </div>
      </form>
      <div className={s.grid}>
        <p className={s.small}>
          Изображения: {detail.attachments.length} из {BROADCAST_MAX_IMAGES} (JPEG или PNG, до 5
          МБ), отправляются в этом порядке.
        </p>
        {detail.attachments.length > 0 && (
          <ul className={s.attachmentList}>
            {detail.attachments.map((a) => (
              <li key={a.id}>
                <img
                  src={attachmentUrl(b.id, a.id)}
                  alt={`Изображение ${a.position}`}
                  loading="lazy"
                />
                <button
                  type="button"
                  className={s.button}
                  disabled={busy !== null}
                  onClick={() =>
                    void run('remove', () =>
                      adminApi.delete(`/broadcasts/${b.id}/attachments/${a.id}`),
                    )
                  }
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        )}
        {detail.attachments.length < BROADCAST_MAX_IMAGES && (
          <label className={s.field}>
            Добавить изображения
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              disabled={busy !== null}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {error !== null && <ErrorState error={error} compact />}
      {dirty && (
        <Note>Есть несохранённые изменения — сохраните черновик перед проверкой и отправкой.</Note>
      )}
      <div className={s.toolbar}>
        <button
          type="button"
          className={s.button}
          disabled={dirty || busy !== null || !detail.validation.ok}
          onClick={() => void run('test', () => adminApi.post(`/broadcasts/${b.id}/test`, {}))}
        >
          Отправить себе
        </button>
        <button
          type="button"
          className={`${s.button} ${s.buttonPrimary}`}
          disabled={dirty || busy !== null || !detail.validation.ok}
          onClick={() =>
            void run('prepare', () => adminApi.post(`/broadcasts/${b.id}/prepare`, {}))
          }
        >
          Перейти к отправке…
        </button>
      </div>
    </Card>
  );
}

function TestStatus({ status }: { status: Broadcast['testStatus'] }) {
  if (!status) return null;
  const text = {
    pending: 'Тестовое сообщение отправляется вам…',
    sent: 'Тестовое сообщение отправлено вам в Telegram.',
    failed: 'Тестовое сообщение не дошло — проверьте раздел «Уведомления».',
    no_recipients: 'Некому отправить тест: подключите Telegram к своему аккаунту и запустите бота.',
  }[status];
  return (
    <p role="status" className={s.small}>
      {text}
    </p>
  );
}

export function BroadcastPage({ id = '' }: Record<string, string>) {
  const query = useAdminQuery<Detail>(`/broadcasts/${encodeURIComponent(id)}`);
  const [dialog, setDialog] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const status = query.data?.broadcast.status;
  const testPending = query.data?.broadcast.testStatus === 'pending';

  // Progress and the test result update by themselves.
  const { reload } = query;
  useEffect(() => {
    if (status !== 'sending' && !testPending) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [status, testPending, reload]);

  const act = async (path: string, body: object = {}) => {
    setError(null);
    await adminApi.post(`/broadcasts/${id}${path}`, body);
    query.reload();
  };

  return (
    <>
      <AdminLink to="/admin/broadcasts" className={`${s.link} ${s.backLink}`}>
        ← Все рассылки
      </AdminLink>
      <QueryView query={query} skeleton={480}>
        {(d) => {
          const b = d.broadcast;
          const total = b.recipientsTotal;
          return (
            <>
              <PageHead
                title="Рассылка"
                subtitle={
                  <p className={s.subtitle}>
                    <StatusBadge status={b.status} /> · создана {dateTime(b.createdAt)}
                  </p>
                }
              />
              <div className={s.grid}>
                {error !== null && <ErrorState error={error} compact />}
                <TestStatus status={b.testStatus} />
                {!d.validation.ok && b.status === 'draft' && (
                  <Note>Пока нельзя отправить: {d.validation.error}</Note>
                )}
                <div className={s.cols2}>
                  {b.status === 'draft' ? (
                    <Editor detail={d} onChanged={query.reload} />
                  ) : (
                    <Card title="Сообщение">
                      <pre className={s.preview}>{b.text || '— без текста —'}</pre>
                      <p className={s.small}>Изображений: {d.attachments.length}</p>
                    </Card>
                  )}
                  <Card title="Предпросмотр" note="Примерно так сообщение выглядит в Telegram">
                    <TelegramPreview
                      broadcastId={b.id}
                      text={b.text}
                      attachments={d.attachments}
                      parts={d.validation.ok ? d.validation.parts : null}
                    />
                  </Card>
                </div>

                {b.status === 'awaiting_confirmation' && (
                  <Card title="Подтверждение отправки">
                    <p className={s.confirmWarning} role="alert">
                      Это сообщение получат <strong>все доступные подписчики бота</strong> — сейчас
                      их <strong>{num(d.recipientsEstimate)}</strong>. Отменить уже доставленные
                      сообщения будет нельзя.
                    </p>
                    <AudienceNote recipients={d.recipientsEstimate} worker={d.worker} />
                    <div className={s.toolbar}>
                      <button
                        type="button"
                        className={`${s.button} ${s.buttonPrimary}`}
                        disabled={d.recipientsEstimate === 0}
                        onClick={() => setDialog('confirm')}
                      >
                        Подтвердить отправку
                      </button>
                      <button
                        type="button"
                        className={s.button}
                        onClick={() => void act('/edit').catch(setError)}
                      >
                        Вернуться к редактированию
                      </button>
                      <button
                        type="button"
                        className={s.button}
                        onClick={() => setDialog('cancel')}
                      >
                        Отменить
                      </button>
                    </div>
                  </Card>
                )}

                {b.status === 'draft' && (
                  <div className={s.toolbar}>
                    <button type="button" className={s.button} onClick={() => setDialog('cancel')}>
                      Отменить черновик
                    </button>
                  </div>
                )}

                {(b.status === 'sending' || total !== null) && (
                  <Card title={b.status === 'sending' ? 'Отправка идёт' : 'Результат'}>
                    <div className={s.kpis}>
                      <Kpi label="Получателей" value={total} />
                      <Kpi label="Доставлено" value={b.sentCount} />
                      <Kpi label="Заблокировали бота" value={b.blockedCount} />
                      <Kpi label="Ошибки" value={b.failedCount} />
                    </div>
                    {total !== null && total > 0 && (
                      <progress
                        className={s.progress}
                        max={total}
                        value={b.sentCount + b.failedCount + b.blockedCount}
                        aria-label="Прогресс рассылки"
                      />
                    )}
                    {d.deliveries.some((x) => x.errorCode) && (
                      <ul className={s.small}>
                        {d.deliveries
                          .filter((x) => x.errorCode)
                          .map((x) => (
                            <li key={`${x.status}-${x.errorCode}-${x.errorDetail ?? ''}`}>
                              {deliveryText[x.status] ?? x.status}:{' '}
                              {errorCodeText[x.errorCode!] ?? x.errorCode}
                              {x.errorDetail && <code> {x.errorDetail}</code>} — {num(x.n)}
                            </li>
                          ))}
                      </ul>
                    )}
                    <p className={s.small}>
                      Начата: {dateTime(b.startedAt)} · Завершена: {dateTime(b.finishedAt)}
                    </p>
                    {b.status === 'sending' && (
                      <button
                        type="button"
                        className={`${s.button} ${s.buttonDanger}`}
                        onClick={() => setDialog('cancel')}
                      >
                        Остановить рассылку
                      </button>
                    )}
                  </Card>
                )}
              </div>
              <ConfirmDialog
                open={dialog === 'confirm'}
                title="Отправить рассылку?"
                confirmLabel={`Отправить ${num(d.recipientsEstimate)} получателям`}
                onConfirm={() => act('/confirm', { confirm: true })}
                onClose={() => setDialog(null)}
              >
                Сообщение уйдёт всем доступным подписчикам бота. Остановить можно будет только те
                отправки, которые ещё не начались.
              </ConfirmDialog>
              <ConfirmDialog
                open={dialog === 'cancel'}
                title={b.status === 'sending' ? 'Остановить рассылку?' : 'Отменить рассылку?'}
                confirmLabel={b.status === 'sending' ? 'Остановить' : 'Отменить'}
                danger
                onConfirm={() => act('/cancel')}
                onClose={() => setDialog(null)}
              >
                {b.status === 'sending'
                  ? 'Новые сообщения перестанут уходить. Уже доставленные останутся у получателей.'
                  : 'Рассылка не будет отправлена. Её останется только просмотреть в истории.'}
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
