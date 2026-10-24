import { useState } from 'react';
import {
  buildClaudeReport,
  buildShortReport,
  formatReportId,
  type ComplaintReportData,
} from '@zybrilka/shared';
import { CopyButton } from '../components/CopyButton.js';
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
  reportNumber: number;
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
  context: { screen: string; path?: string; variantId?: string } | null;
  duplicateOf: number | null;
  handledByUserId: string | null;
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
  reportNumber: number;
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
    duplicateOf?: string | null;
  } | null;
  actorUserId: string | null;
  createdAt: string;
}

interface ComplaintCard {
  complaint: ComplaintRow & {
    taskStatus: string;
    taskStatement: string;
    taskAnswer: string;
    taskExplanation: string;
    snapshot: {
      statement: string;
      answer: string;
      explanation: string;
      taskUpdatedAt: string | null;
    } | null;
  };
  report: ComplaintReportData;
  others: OtherComplaint[];
  history: AuditEntry[];
}

const screenText: Record<string, string> = {
  task: 'Задание',
  result: 'Результат проверки',
  variant: 'Вариант',
  mistakes: 'Мои ошибки',
  other: 'Другое',
};

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
  const q = p.get('q')?.trim() || undefined;
  const sortParam = p.get('sort');
  const sort = sortParam === 'newest' || sortParam === 'oldest' ? sortParam : undefined;
  const page = Math.max(1, Number(p.get('page')) || 1);
  const filters = { status, reason, subject, q, sort };
  const hasFilters = Boolean(status || reason || subject || q);
  const [search, setSearch] = useState(q ?? '');
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
          {formatReportId(r.reportNumber)}
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
    {
      key: 'status',
      label: 'Статус',
      render: (r) => (
        <>
          <StatusBadge status={r.status} />
          {r.duplicateOf !== null && (
            <span className={s.small}> дубликат {formatReportId(r.duplicateOf)}</span>
          )}
        </>
      ),
    },
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
        <form
          className={s.filters}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ q: search.trim() || null });
          }}
        >
          <label className={`${s.field} ${s.search}`}>
            Поиск по ID
            <input
              className={s.input}
              type="search"
              value={search}
              placeholder="RPT-12, ID жалобы или задания"
              maxLength={64}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button type="submit" className={s.button}>
            Найти
          </button>
        </form>
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
          <label className={s.field}>
            Сортировка
            <select
              className={s.select}
              value={sort ?? 'new'}
              onChange={(e) =>
                setFilter({ sort: e.target.value === 'new' ? null : e.target.value })
              }
            >
              <option value="new">Сначала новые необработанные</option>
              <option value="newest">По дате: новые сверху</option>
              <option value="oldest">По дате: старые сверху</option>
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
  if (entry.details && 'duplicateOf' in entry.details) {
    parts.push(entry.details.duplicateOf ? 'отмечена как дубликат' : 'снята отметка «дубликат»');
  }
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
  const [duplicateOf, setDuplicateOf] = useState('');

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
  const markDuplicate = async (value: string | null) => {
    setBusy(true);
    setWriteError(null);
    try {
      await adminApi.patch(path, { duplicateOf: value });
      setDuplicateOf('');
      query.reload();
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
                title={`Жалоба ${formatReportId(c.reportNumber)}`}
                subtitle={
                  <p className={s.subtitle}>
                    {reasonText(c.reason)} · <StatusBadge status={c.status} />
                    {c.duplicateOf !== null && <> · дубликат {formatReportId(c.duplicateOf)}</>}
                  </p>
                }
              />
              <div className={s.grid}>
                <Note>Все изменения записываются в журнал действий.</Note>
                {writeError !== null && <ErrorState error={writeError} compact />}
                <Card
                  title="Передать в работу"
                  note="Структурированный отчёт: задание, ответ, текст пользователя, контекст"
                >
                  <div className={s.toolbar}>
                    <CopyButton
                      text={buildClaudeReport(d.report)}
                      label="Скопировать для Claude"
                      primary
                    />
                    <CopyButton text={buildShortReport(d.report)} label="Краткая версия" />
                    <CopyButton text={formatReportId(c.reportNumber)} label="ID жалобы" />
                  </div>
                </Card>
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
                      <dt>Номер</dt>
                      <dd className={s.mono}>{formatReportId(c.reportNumber)}</dd>
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
                      <dt>Откуда</dt>
                      <dd>
                        {c.context ? (
                          <>
                            {screenText[c.context.screen] ?? c.context.screen}
                            {c.context.path && (
                              <span className={`${s.mono} ${s.small}`}> {c.context.path}</span>
                            )}
                          </>
                        ) : (
                          <span className={s.muted}>не сохранено</span>
                        )}
                      </dd>
                      <dt>Обработал</dt>
                      <dd>
                        {c.handledByUserId ? (
                          <span className={s.mono}>{shortId(c.handledByUserId)}</span>
                        ) : (
                          <span className={s.muted}>—</span>
                        )}
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
                      <dt>Источник</dt>
                      <dd>{d.report.source ?? '—'}</dd>
                      <dt>Вариант</dt>
                      <dd>{d.report.variant ?? '—'}</dd>
                      <dt>ID задания</dt>
                      <dd className={s.mono}>{c.taskId}</dd>
                      <dt>Статус задания</dt>
                      <dd>{taskStatusText[c.taskStatus] ?? c.taskStatus}</dd>
                    </dl>
                  </Card>
                </div>
                <Card
                  title={c.snapshot ? 'Задание на момент жалобы' : 'Условие задания'}
                  note={
                    c.snapshot
                      ? d.report.taskChangedSinceReport
                        ? 'Задание с тех пор изменено — ниже версия, которую видел пользователь'
                        : 'С тех пор задание не менялось'
                      : 'Снимок не сохранён (жалоба старше этой функции) — показана текущая версия'
                  }
                >
                  <p className={s.small}>Условие</p>
                  <div className={s.preview}>
                    {(c.snapshot?.statement ?? c.taskStatement) || (
                      <span className={s.muted}>Условие пустое.</span>
                    )}
                  </div>
                  <dl className={s.dl}>
                    <dt>Ответ</dt>
                    <dd className={s.mono}>{c.snapshot?.answer ?? c.taskAnswer}</dd>
                  </dl>
                  <details>
                    <summary className={s.small}>Решение / объяснение</summary>
                    <div className={s.preview}>{c.snapshot?.explanation ?? c.taskExplanation}</div>
                  </details>
                  {c.snapshot && d.report.taskChangedSinceReport && (
                    <details>
                      <summary className={s.small}>Текущая версия задания</summary>
                      <div className={s.preview}>{c.taskStatement}</div>
                      <p className={s.small}>
                        Ответ сейчас: <span className={s.mono}>{c.taskAnswer}</span>
                      </p>
                    </details>
                  )}
                </Card>
                <div className={s.cols2}>
                  <Card title="Дубликат">
                    {c.duplicateOf !== null ? (
                      <div className={s.toolbar}>
                        <span>
                          Дубликат жалобы <strong>{formatReportId(c.duplicateOf)}</strong>
                        </span>
                        <button
                          type="button"
                          className={s.button}
                          disabled={busy}
                          onClick={() => void markDuplicate(null)}
                        >
                          Снять отметку
                        </button>
                      </div>
                    ) : (
                      <form
                        className={s.filters}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (duplicateOf.trim()) void markDuplicate(duplicateOf.trim());
                        }}
                      >
                        <label className={s.field}>
                          Исходная жалоба
                          <input
                            className={s.input}
                            value={duplicateOf}
                            placeholder="RPT-12"
                            maxLength={64}
                            onChange={(e) => setDuplicateOf(e.target.value)}
                          />
                        </label>
                        <button
                          type="submit"
                          className={s.button}
                          disabled={busy || !duplicateOf.trim()}
                        >
                          Отметить как дубликат
                        </button>
                      </form>
                    )}
                    <p className={s.small}>
                      Дубликат закрывается со статусом «Отклонена»; работа ведётся по исходной
                      жалобе.
                    </p>
                  </Card>
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
                </div>
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
                              {formatReportId(r.reportNumber)}
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
