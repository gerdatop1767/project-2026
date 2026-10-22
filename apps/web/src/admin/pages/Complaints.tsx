import { useState } from 'react';
import { PageHead } from '../components/Shell.js';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Note,
  Pager,
  QueryView,
  Segmented,
  type Column,
} from '../components/ui.js';
import { AdminApiError, adminApi } from '../adminApi.js';
import {
  complaintReasonText,
  complaintStatusText,
  dateTime,
  num,
  subjectNames,
  taskStatusText,
} from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type ComplaintStatus = 'new' | 'in_progress' | 'fixed' | 'rejected';

type ComplaintRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  subjectId: string;
  taskId: string;
  taskNumber: number | null;
  sourceYear: number | null;
  reason: string;
  comment: string | null;
  status: ComplaintStatus;
  internalComment: string | null;
  userId: string | null;
  otherComplaints: number;
};

interface ComplaintList {
  total: number;
  page: number;
  pageSize: number;
  items: ComplaintRow[];
  counts: Partial<Record<ComplaintStatus, number>>;
}

type OtherComplaint = {
  id: string;
  reason: string;
  status: ComplaintStatus;
  comment: string | null;
  createdAt: string;
};

interface AuditEntry {
  id: string;
  action: string;
  result: string;
  details: {
    status?: { from: string; to: string };
    internalCommentChanged?: boolean;
  } | null;
  actorUserId: string | null;
  createdAt: string;
}

interface ComplaintCard {
  complaint: ComplaintRow & { taskPreview: string | null; taskStatus: string };
  others: OtherComplaint[];
  history: AuditEntry[];
}

const PAGE_SIZE = 25;
const statuses: ComplaintStatus[] = ['new', 'in_progress', 'fixed', 'rejected'];
const reasons = Object.keys(complaintReasonText);

const statusTone: Record<ComplaintStatus, 'bad' | 'warn' | 'good' | 'neutral'> = {
  new: 'bad',
  in_progress: 'warn',
  fixed: 'good',
  rejected: 'neutral',
};

const shortId = (id: string) => id.slice(0, 8);
const subjectName = (id: string) => subjectNames[id] ?? id;
const reasonText = (r: string) => complaintReasonText[r] ?? r;
const truncate = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={statusTone[status as ComplaintStatus] ?? 'neutral'}>
      {complaintStatusText[status] ?? status}
    </Badge>
  );
}

export function ComplaintsPage() {
  const { location, setParams } = useAdminRouter();
  const p = location.params;
  const statusParam = p.get('status');
  const status = statuses.includes(statusParam as ComplaintStatus)
    ? (statusParam as ComplaintStatus)
    : undefined;
  const reasonParam = p.get('reason');
  const reason = reasonParam && reasons.includes(reasonParam) ? reasonParam : undefined;
  const subject = p.get('subject') ?? undefined;
  const page = Math.max(1, Number(p.get('page')) || 1);
  const filters = { status, reason, subject };
  const hasFilters = Boolean(status || reason || subject);
  const query = useAdminQuery<ComplaintList>('/complaints', {
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });
  const setFilter = (patch: Record<string, string | null>) => setParams({ ...patch, page: null });

  const counts = query.data?.counts ?? {};
  const allCount = statuses.reduce((sum, st) => sum + (counts[st] ?? 0), 0);
  const withCount = (label: string, n: number | undefined) =>
    query.data ? `${label} · ${num(n ?? 0)}` : label;

  const columns: Column<ComplaintRow>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (r) => (
        <AdminLink to={`/admin/complaints/${r.id}`} className={`${s.link} ${s.mono}`} title={r.id}>
          {shortId(r.id)}
        </AdminLink>
      ),
    },
    { key: 'createdAt', label: 'Дата', render: (r) => dateTime(r.createdAt) },
    { key: 'subjectId', label: 'Предмет', render: (r) => subjectName(r.subjectId) },
    {
      key: 'taskId',
      label: 'Задание',
      render: (r) => (
        <AdminLink
          to={`/admin/content/tasks/${r.taskId}`}
          className={`${s.link} ${s.mono}`}
          title={r.taskId}
        >
          {shortId(r.taskId)}
        </AdminLink>
      ),
    },
    { key: 'taskNumber', label: '№', numeric: true },
    { key: 'reason', label: 'Причина', render: (r) => reasonText(r.reason) },
    {
      key: 'comment',
      label: 'Текст',
      render: (r) =>
        r.comment ? (
          <span title={r.comment}>{truncate(r.comment)}</span>
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    { key: 'status', label: 'Статус', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'otherComplaints', label: 'Ещё жалоб на задание', numeric: true },
    {
      key: 'userId',
      label: 'Отправитель',
      render: (r) =>
        r.userId ? (
          <AdminLink
            to={`/admin/users/${r.userId}`}
            className={`${s.link} ${s.mono}`}
            title={r.userId}
          >
            {shortId(r.userId)}
          </AdminLink>
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
  ];

  return (
    <>
      <PageHead
        title="Жалобы на задания"
        actions={
          <a
            className={s.button}
            href={adminApi.exportUrl('complaints', filters)}
            download
            title="Жалобы за последние 30 дней с текущими фильтрами"
          >
            CSV (30 дней)
          </a>
        }
      />
      <div className={s.grid}>
        <Segmented
          label="Статус жалобы"
          value={status ?? 'all'}
          options={[
            { value: 'all', label: withCount('Все', allCount) },
            ...statuses.map((st) => ({
              value: st,
              label: withCount(complaintStatusText[st] ?? st, counts[st]),
            })),
          ]}
          onChange={(v) => setFilter({ status: v === 'all' ? null : v })}
        />
        <div className={s.filters}>
          <label className={s.field}>
            Причина
            <select
              className={s.select}
              value={reason ?? ''}
              onChange={(e) => setFilter({ reason: e.target.value || null })}
            >
              <option value="">Все причины</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {reasonText(r)}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            Предмет
            <select
              className={s.select}
              value={subject ?? ''}
              onChange={(e) => setFilter({ subject: e.target.value || null })}
            >
              <option value="">Все предметы</option>
              {Object.entries(subjectNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <QueryView
          query={query}
          skeleton={420}
          isEmpty={(d) => d.total === 0}
          empty={
            hasFilters
              ? 'По этим фильтрам жалоб нет.'
              : 'Жалоб пока нет — пользователи отправляют их из задания (⚠️ «Пожаловаться»).'
          }
        >
          {(d) => (
            <Card>
              <DataTable
                caption="Жалобы на задания"
                columns={columns}
                rows={d.items}
                rowKey={(r) => r.id}
              />
              <Pager
                page={d.page}
                pageSize={d.pageSize}
                total={d.total}
                onPage={(n) => setParams({ page: n > 1 ? String(n) : null })}
              />
            </Card>
          )}
        </QueryView>
      </div>
    </>
  );
}

const transitions: { to: ComplaintStatus; label: string }[] = [
  { to: 'in_progress', label: 'В работу' },
  { to: 'fixed', label: 'Исправлено' },
  { to: 'rejected', label: 'Отклонить' },
  { to: 'new', label: 'Вернуть в новые' },
];

const isClosing = (st: ComplaintStatus) => st === 'fixed' || st === 'rejected';

function historyText(entry: AuditEntry): string {
  const parts: string[] = [];
  const st = entry.details?.status;
  if (st) {
    parts.push(
      `статус: ${complaintStatusText[st.from] ?? st.from} → ${complaintStatusText[st.to] ?? st.to}`,
    );
  }
  if (entry.details?.internalCommentChanged) parts.push('изменён внутренний комментарий');
  if (parts.length === 0)
    parts.push(entry.action === 'complaint.updated' ? 'изменение' : entry.action);
  return parts.join('; ');
}

const isNotFound = (error: unknown) =>
  error instanceof AdminApiError &&
  (error.status === 404 || (error.status === 400 && error.code === 'invalid_id'));

export function ComplaintPage({ id = '' }: Record<string, string>) {
  const path = `/complaints/${encodeURIComponent(id)}`;
  const query = useAdminQuery<ComplaintCard>(path);
  const [pending, setPending] = useState<ComplaintStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<unknown>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const back = (
    <AdminLink to="/admin/complaints" className={`${s.link} ${s.backLink}`}>
      ← Все жалобы
    </AdminLink>
  );

  if (query.data === null && query.status === 'error' && isNotFound(query.error)) {
    return (
      <>
        {back}
        <div className={s.state}>
          <p>Жалоба не найдена.</p>
        </div>
      </>
    );
  }

  const setStatus = async (to: ComplaintStatus) => {
    await adminApi.patch(path, { status: to });
    query.reload();
  };
  const changeStatus = async (to: ComplaintStatus) => {
    if (isClosing(to)) {
      setPending(to);
      return;
    }
    setBusy(true);
    setWriteError(null);
    try {
      await setStatus(to);
    } catch (e) {
      setWriteError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveComment = async (text: string) => {
    setBusy(true);
    setWriteError(null);
    setSaved(false);
    try {
      await adminApi.patch(path, { internalComment: text.trim() || null });
      setSaved(true);
      query.reload();
    } catch (e) {
      setWriteError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {back}
      <QueryView query={query} skeleton={480}>
        {(d) => {
          const c = d.complaint;
          const commentValue = comment ?? c.internalComment ?? '';
          return (
            <>
              <PageHead
                title={`Жалоба ${shortId(c.id)}`}
                subtitle={
                  <p className={s.subtitle}>
                    {reasonText(c.reason)} · <StatusBadge status={c.status} />
                  </p>
                }
              />
              <div className={s.grid}>
                <Note>Все изменения записываются в журнал действий.</Note>
                {writeError !== null && <ErrorState error={writeError} compact />}
                <Card title="Статус">
                  <div className={s.toolbar}>
                    {transitions
                      .filter((t) => t.to !== c.status)
                      .map((t) => (
                        <button
                          key={t.to}
                          type="button"
                          className={`${s.button} ${t.to === 'in_progress' ? s.buttonPrimary : ''}`}
                          disabled={busy}
                          onClick={() => void changeStatus(t.to)}
                        >
                          {t.label}
                        </button>
                      ))}
                  </div>
                </Card>
                <div className={s.cols2}>
                  <Card title="Жалоба">
                    <dl className={s.dl}>
                      <dt>ID</dt>
                      <dd className={s.mono}>{c.id}</dd>
                      <dt>Создана</dt>
                      <dd>{dateTime(c.createdAt)}</dd>
                      <dt>Обновлена</dt>
                      <dd>{dateTime(c.updatedAt)}</dd>
                      <dt>Закрыта</dt>
                      <dd>{dateTime(c.resolvedAt)}</dd>
                      <dt>Причина</dt>
                      <dd>{reasonText(c.reason)}</dd>
                      <dt>Текст</dt>
                      <dd>{c.comment ?? <span className={s.muted}>—</span>}</dd>
                      <dt>Статус</dt>
                      <dd>
                        <StatusBadge status={c.status} />
                      </dd>
                      <dt>Отправитель</dt>
                      <dd>
                        {c.userId ? (
                          <AdminLink
                            to={`/admin/users/${c.userId}`}
                            className={`${s.link} ${s.mono}`}
                          >
                            {shortId(c.userId)}
                          </AdminLink>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </dl>
                  </Card>
                  <Card
                    title="Задание"
                    actions={
                      <AdminLink to={`/admin/content/tasks/${c.taskId}`} className={s.link}>
                        Открыть задание
                      </AdminLink>
                    }
                  >
                    <dl className={s.dl}>
                      <dt>Предмет</dt>
                      <dd>{subjectName(c.subjectId)}</dd>
                      <dt>№ ЕГЭ</dt>
                      <dd>{c.taskNumber ?? '—'}</dd>
                      <dt>Год</dt>
                      <dd>{c.sourceYear ?? '—'}</dd>
                      <dt>Статус задания</dt>
                      <dd>{taskStatusText[c.taskStatus] ?? c.taskStatus}</dd>
                    </dl>
                    <p className={s.small}>Начало условия:</p>
                    <div className={s.preview}>
                      {c.taskPreview || <span className={s.muted}>Условие пустое.</span>}
                    </div>
                  </Card>
                </div>
                <Card title="Внутренний комментарий" note="Виден только в админке">
                  <form
                    className={s.grid}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveComment(commentValue);
                    }}
                  >
                    <label className={s.field}>
                      Комментарий
                      <textarea
                        className={s.textarea}
                        value={commentValue}
                        maxLength={2000}
                        onChange={(e) => {
                          setComment(e.target.value);
                          setSaved(false);
                        }}
                      />
                    </label>
                    <div className={s.toolbar}>
                      <button
                        type="submit"
                        className={`${s.button} ${s.buttonPrimary}`}
                        disabled={busy || commentValue === (c.internalComment ?? '')}
                      >
                        Сохранить
                      </button>
                      {saved && (
                        <span role="status" className={s.muted}>
                          Сохранено
                        </span>
                      )}
                    </div>
                  </form>
                </Card>
                <Card title="Другие жалобы на это задание">
                  {d.others.length === 0 ? (
                    <p className={s.muted}>Других жалоб нет.</p>
                  ) : (
                    <DataTable
                      caption="Другие жалобы на это задание"
                      rowKey={(r) => r.id}
                      rows={d.others}
                      columns={[
                        {
                          key: 'id',
                          label: 'ID',
                          render: (r) => (
                            <AdminLink
                              to={`/admin/complaints/${r.id}`}
                              className={`${s.link} ${s.mono}`}
                              title={r.id}
                            >
                              {shortId(r.id)}
                            </AdminLink>
                          ),
                        },
                        { key: 'createdAt', label: 'Дата', render: (r) => dateTime(r.createdAt) },
                        { key: 'reason', label: 'Причина', render: (r) => reasonText(r.reason) },
                        {
                          key: 'comment',
                          label: 'Текст',
                          render: (r) => (r.comment ? truncate(r.comment) : '—'),
                        },
                        {
                          key: 'status',
                          label: 'Статус',
                          render: (r) => <StatusBadge status={r.status} />,
                        },
                      ]}
                    />
                  )}
                </Card>
                <Card title="История">
                  {d.history.length === 0 ? (
                    <p className={s.muted}>Изменений ещё не было.</p>
                  ) : (
                    <ul className={s.grid} style={{ margin: 0, paddingLeft: '1.25rem' }}>
                      {d.history.map((h) => (
                        <li key={h.id} className={s.small}>
                          <span className={s.muted}>{dateTime(h.createdAt)}</span> —{' '}
                          {historyText(h)}
                          {h.result !== 'ok' && ` (${h.result})`}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              <ConfirmDialog
                open={pending !== null}
                title={pending === 'fixed' ? 'Отметить как исправленную?' : 'Отклонить жалобу?'}
                confirmLabel={pending === 'fixed' ? 'Исправлено' : 'Отклонить'}
                danger={pending === 'rejected'}
                onConfirm={async () => {
                  if (pending) await setStatus(pending);
                }}
                onClose={() => setPending(null)}
              >
                Жалоба будет закрыта со статусом «{pending ? complaintStatusText[pending] : ''}». Её
                можно вернуть в новые позже. Изменение записывается в журнал.
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
