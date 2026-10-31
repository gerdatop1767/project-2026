import { useState, type FormEvent } from 'react';
import { StackedBarsChart } from '../components/charts.js';
import { PageHead } from '../components/Shell.js';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Kpi,
  Note,
  Pager,
  QueryView,
  Segmented,
  type Column,
} from '../components/ui.js';
import { AdminApiError, adminApi } from '../adminApi.js';
import {
  bucketLabel,
  complaintReasonText,
  complaintStatusText,
  date,
  dateTime,
  num,
  pct,
  ratio,
  subjectNames,
} from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type UserStatus = 'new' | 'active' | 'no_solves' | 'dormant' | 'idle';

type UserRow = {
  id: string;
  name: string | null;
  registeredAt: string;
  lastActivity: string | null;
  subjects: string[] | null;
  solves: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  activeDays: number;
  source: string;
  campaign: string | null;
  methods: string[] | null;
  status: UserStatus;
};

interface UserList {
  total: number;
  page: number;
  pageSize: number;
  items: UserRow[];
}

type SubjectStat = { subjectId: string; attempts: number; correct: number; solved: number };
type NumberStat = {
  subjectId: string;
  taskNumber: number | null;
  attempts: number;
  correct: number;
};
type TopicStat = { topic: string; subjectId: string; attempts: number; correct: number };
type Mistake = {
  taskId: string;
  subjectId: string;
  taskNumber: number | null;
  timesWrong: number;
  status: 'open' | 'resolved';
  updatedAt: string;
};
type HistoryRow = {
  id: string;
  taskId: string;
  subjectId: string;
  taskNumber: number | null;
  correct: boolean;
  timeSpentMs: number | null;
  createdAt: string;
};
type UserComplaint = {
  id: string;
  taskId: string;
  reason: string;
  status: string;
  createdAt: string;
};

interface UserCard {
  user: UserRow & {
    firstAnswer: string | null;
    lastAnswer: string | null;
    firstSolve: string | null;
  };
  streaks: { current: number; best: number };
  activity90d: { day: string; attempts: number; correct: number }[];
  bySubject: SubjectStat[];
  byNumber: NumberStat[];
  byTopic: TopicStat[];
  mistakes: Mistake[];
  history: HistoryRow[];
  complaints: UserComplaint[];
  activeSessions: number;
}

const PAGE_SIZE = 25;

const segments = [
  { value: 'all', label: 'Все' },
  { value: 'new7', label: 'Новые за 7 дней' },
  { value: 'active7', label: 'Активные 7 дней' },
  { value: 'active30', label: 'Активные 30 дней' },
  { value: 'dormant', label: 'Уснувшие (>30 дней)' },
  { value: 'no_solves', label: 'Без решений' },
] as const;
type Segment = (typeof segments)[number]['value'];

const minSolvesOptions = [1, 5, 10, 25, 50, 100];
const sortKeys = ['registered', 'lastActivity', 'solves', 'accuracy', 'activeDays'];

const statusInfo: Record<
  UserStatus,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }
> = {
  new: { label: 'Новый', tone: 'info' },
  active: { label: 'Активен', tone: 'good' },
  no_solves: { label: 'Без решений', tone: 'warn' },
  dormant: { label: 'Уснул', tone: 'bad' },
  idle: { label: 'Неактивен', tone: 'neutral' },
};

const shortId = (id: string) => id.slice(0, 8);
const subjectName = (id: string) => subjectNames[id] ?? id;
const userSourceText = (source: string) => (source === 'unknown' ? 'Неизвестно' : source);

function StatusBadge({ status }: { status: UserStatus }) {
  const info = statusInfo[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

function seconds(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} с`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${m} мин ${sec} с` : `${m} мин`;
}

export function UsersPage() {
  const { location, setParams } = useAdminRouter();
  const p = location.params;
  const segmentParam = p.get('segment');
  const segment: Segment = segments.some((x) => x.value === segmentParam)
    ? (segmentParam as Segment)
    : 'all';
  const sortParam = p.get('sort') ?? '';
  const sort = sortKeys.includes(sortParam) ? sortParam : 'registered';
  const dir: 'asc' | 'desc' = p.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(p.get('page')) || 1);
  const filters = {
    q: p.get('q') ?? undefined,
    segment: segment === 'all' ? undefined : segment,
    minSolves: p.get('minSolves') ?? undefined,
    subject: p.get('subject') ?? undefined,
    source: p.get('source') ?? undefined,
    registeredFrom: p.get('registeredFrom') ?? undefined,
    registeredTo: p.get('registeredTo') ?? undefined,
  };
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '');
  const query = useAdminQuery<UserList>('/users', {
    ...filters,
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  });
  const [search, setSearch] = useState(filters.q ?? '');
  const [source, setSource] = useState(filters.source ?? '');

  const setFilter = (patch: Record<string, string | null>) => setParams({ ...patch, page: null });
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter({ q: search.trim() || null, source: source.trim() || null });
  };
  const onSort = (key: string) => {
    if (key === sort) setParams({ sort: key, dir: dir === 'desc' ? 'asc' : 'desc', page: null });
    else setParams({ sort: key, dir: 'desc', page: null });
  };

  const columns: Column<UserRow>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (r) => (
        <AdminLink to={`/admin/users/${r.id}`} className={`${s.link} ${s.mono}`} title={r.id}>
          {shortId(r.id)}
        </AdminLink>
      ),
    },
    {
      key: 'name',
      label: 'Имя',
      render: (r) => r.name ?? <span className={s.muted}>без имени</span>,
    },
    {
      key: 'registeredAt',
      label: 'Регистрация',
      sort: 'registered',
      render: (r) => date(r.registeredAt),
    },
    {
      key: 'lastActivity',
      label: 'Последняя активность',
      sort: 'lastActivity',
      render: (r) => dateTime(r.lastActivity),
    },
    {
      key: 'subjects',
      label: 'Предметы',
      render: (r) =>
        r.subjects && r.subjects.length > 0 ? (
          r.subjects.map(subjectName).join(', ')
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    { key: 'solves', label: 'Решений', numeric: true, sort: 'solves' },
    {
      key: 'correct',
      label: 'Верно / неверно',
      numeric: true,
      render: (r) => `${num(r.correct)} / ${num(r.incorrect)}`,
    },
    {
      key: 'accuracy',
      label: 'Точность',
      numeric: true,
      sort: 'accuracy',
      render: (r) => pct(r.accuracy),
    },
    { key: 'activeDays', label: 'Активных дней', numeric: true, sort: 'activeDays' },
    {
      key: 'source',
      label: 'Источник',
      render: (r) => userSourceText(r.source),
    },
    { key: 'status', label: 'Статус', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHead
        title="Пользователи"
        subtitle={query.data && <p className={s.subtitle}>Найдено: {num(query.data.total)}</p>}
        actions={
          <a
            className={s.button}
            href={adminApi.exportUrl('users', { ...filters, sort, dir })}
            download
          >
            CSV
          </a>
        }
      />
      <div className={s.grid}>
        <Note>
          Показываются только зарегистрированные аккаунты. «Последняя активность» — последний
          проверенный ответ или визит; это не «онлайн сейчас».
        </Note>
        <Segmented
          label="Сегмент"
          value={segment}
          options={segments}
          onChange={(v) => setFilter({ segment: v === 'all' ? null : v })}
        />
        <form className={s.filters} onSubmit={onSearch} role="search">
          <label className={s.field}>
            Поиск (ID или имя)
            <input
              className={s.input}
              type="search"
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Начало ID или часть имени"
            />
          </label>
          <label className={s.field}>
            Источник
            <input
              className={s.input}
              type="text"
              value={source}
              maxLength={64}
              onChange={(e) => setSource(e.target.value)}
              placeholder="например, unknown"
            />
          </label>
          <span className={s.field}>
            <span aria-hidden="true">&nbsp;</span>
            <button type="submit" className={`${s.button} ${s.buttonPrimary}`}>
              Найти
            </button>
          </span>
        </form>
        <div className={s.filters}>
          <label className={s.field}>
            Решений
            <select
              className={s.select}
              value={filters.minSolves ?? ''}
              onChange={(e) => setFilter({ minSolves: e.target.value || null })}
            >
              <option value="">Любое число</option>
              {minSolvesOptions.map((n) => (
                <option key={n} value={String(n)}>
                  ≥ {n} решений
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            Предмет
            <select
              className={s.select}
              value={filters.subject ?? ''}
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
            Регистрация с
            <input
              className={s.input}
              type="date"
              value={filters.registeredFrom ?? ''}
              onChange={(e) => setFilter({ registeredFrom: e.target.value || null })}
            />
          </label>
          <label className={s.field}>
            Регистрация по
            <input
              className={s.input}
              type="date"
              value={filters.registeredTo ?? ''}
              onChange={(e) => setFilter({ registeredTo: e.target.value || null })}
            />
          </label>
          {hasFilters && (
            <span className={s.field}>
              <span aria-hidden="true">&nbsp;</span>
              <button
                type="button"
                className={s.button}
                onClick={() => {
                  setSearch('');
                  setSource('');
                  setFilter({
                    q: null,
                    segment: null,
                    minSolves: null,
                    subject: null,
                    source: null,
                    registeredFrom: null,
                    registeredTo: null,
                  });
                }}
              >
                Сбросить фильтры
              </button>
            </span>
          )}
        </div>
        <QueryView
          query={query}
          skeleton={480}
          isEmpty={(d) => d.total === 0}
          empty={
            hasFilters
              ? 'По этим фильтрам пользователей не найдено.'
              : 'Зарегистрированных пользователей пока нет.'
          }
        >
          {(d) => (
            <Card>
              <DataTable
                caption="Пользователи"
                columns={columns}
                rows={d.items}
                rowKey={(r) => r.id}
                sort={sort}
                dir={dir}
                onSort={onSort}
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

const isNotFound = (error: unknown) =>
  error instanceof AdminApiError &&
  (error.status === 404 || (error.status === 400 && error.code === 'invalid_id'));

export function UserPage({ id = '' }: Record<string, string>) {
  const path = `/users/${encodeURIComponent(id)}`;
  const query = useAdminQuery<UserCard>(path);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revokeResult, setRevokeResult] = useState<string | null>(null);

  const back = (
    <AdminLink to="/admin/users" className={`${s.link} ${s.backLink}`}>
      ← Все пользователи
    </AdminLink>
  );

  if (query.data === null && query.status === 'error' && isNotFound(query.error)) {
    return (
      <>
        {back}
        <div className={s.state}>
          <p>Пользователь не найден.</p>
        </div>
      </>
    );
  }

  const revoke = async () => {
    try {
      const r = await adminApi.post<{ revoked: number }>(`${path}/revoke-sessions`, {
        confirm: true,
      });
      setRevokeResult(`Завершено сессий: ${num(r.revoked)}.`);
    } catch (e) {
      if (e instanceof AdminApiError && e.code === 'cannot_revoke_own_sessions') {
        setRevokeResult('Свои сессии отсюда завершить нельзя.');
        return;
      }
      throw e;
    }
    query.reload();
  };

  return (
    <>
      {back}
      <QueryView query={query} skeleton={520}>
        {(d) => {
          const u = d.user;
          const answered = d.activity90d.some((x) => x.attempts > 0);
          return (
            <>
              <PageHead
                title={u.name ?? 'Без имени'}
                subtitle={
                  <p className={s.subtitle}>
                    <span className={s.mono}>{u.id}</span> · <StatusBadge status={u.status} />
                  </p>
                }
                actions={
                  <button
                    type="button"
                    className={`${s.button} ${s.buttonDanger}`}
                    disabled={d.activeSessions === 0}
                    onClick={() => {
                      setRevokeResult(null);
                      setConfirmOpen(true);
                    }}
                  >
                    Завершить все сессии
                  </button>
                }
              />
              <div className={s.grid}>
                {revokeResult && <Note>{revokeResult}</Note>}
                <Card title="Профиль">
                  <dl className={s.dl}>
                    <dt>Способы входа</dt>
                    <dd>{u.methods && u.methods.length > 0 ? u.methods.join(', ') : '—'}</dd>
                    <dt>Регистрация</dt>
                    <dd>{dateTime(u.registeredAt)}</dd>
                    <dt>Первый ответ</dt>
                    <dd>{dateTime(u.firstAnswer)}</dd>
                    <dt>Последний ответ</dt>
                    <dd>{dateTime(u.lastAnswer)}</dd>
                    <dt>Первое верное решение</dt>
                    <dd>{dateTime(u.firstSolve)}</dd>
                    <dt>Последняя активность</dt>
                    <dd>{dateTime(u.lastActivity)}</dd>
                    <dt>Источник</dt>
                    <dd>
                      {userSourceText(u.source)}
                      {u.campaign && ` · кампания «${u.campaign}»`}
                    </dd>
                    <dt>Предметы</dt>
                    <dd>
                      {u.subjects && u.subjects.length > 0
                        ? u.subjects.map(subjectName).join(', ')
                        : '—'}
                    </dd>
                  </dl>
                </Card>
                <div className={s.kpis}>
                  <Kpi label="Решений (ответов)" value={u.solves} />
                  <Kpi label="Верно" value={u.correct} />
                  <Kpi label="Неверно" value={u.incorrect} />
                  <Kpi label="Точность" value={u.accuracy} format={(v) => pct(v)} />
                  <Kpi label="Активных дней" value={u.activeDays} />
                  <Kpi
                    label="Серия сейчас"
                    value={d.streaks.current}
                    hint={`лучшая ${num(d.streaks.best)}`}
                  />
                  <Kpi label="Активных сессий" value={d.activeSessions} />
                </div>
                <Card title="Активность за 90 дней" note="Только дни с ответами (МСК)">
                  {answered ? (
                    <StackedBarsChart
                      title="Верные и неверные ответы по дням"
                      series={[
                        { key: 'ok', label: 'Верно', color: 'var(--color-success)' },
                        { key: 'bad', label: 'Неверно', color: 'var(--color-error)' },
                      ]}
                      rows={d.activity90d.map((x) => ({
                        label: bucketLabel(x.day, 'day'),
                        values: { ok: x.correct, bad: x.attempts - x.correct },
                      }))}
                    />
                  ) : (
                    <p className={s.muted}>За 90 дней ответов не было.</p>
                  )}
                </Card>
                <div className={s.cols2}>
                  <Card title="По предметам">
                    {d.bySubject.length === 0 ? (
                      <p className={s.muted}>Ответов пока нет.</p>
                    ) : (
                      <DataTable
                        caption="По предметам"
                        rowKey={(r) => r.subjectId}
                        rows={d.bySubject}
                        columns={[
                          {
                            key: 'subjectId',
                            label: 'Предмет',
                            render: (r) => subjectName(r.subjectId),
                          },
                          { key: 'attempts', label: 'Ответов', numeric: true },
                          { key: 'correct', label: 'Верно', numeric: true },
                          {
                            key: 'acc',
                            label: 'Точность',
                            numeric: true,
                            render: (r) => pct(ratio(r.correct, r.attempts)),
                          },
                          { key: 'solved', label: 'Решено заданий', numeric: true },
                        ]}
                      />
                    )}
                  </Card>
                  <Card title="По номерам ЕГЭ">
                    {d.byNumber.length === 0 ? (
                      <p className={s.muted}>Ответов пока нет.</p>
                    ) : (
                      <DataTable
                        caption="По номерам ЕГЭ"
                        rowKey={(r) => `${r.subjectId}-${r.taskNumber ?? 'none'}`}
                        rows={d.byNumber}
                        columns={[
                          {
                            key: 'subjectId',
                            label: 'Предмет',
                            render: (r) => subjectName(r.subjectId),
                          },
                          { key: 'taskNumber', label: '№', numeric: true },
                          { key: 'attempts', label: 'Ответов', numeric: true },
                          {
                            key: 'acc',
                            label: 'Точность',
                            numeric: true,
                            render: (r) => pct(ratio(r.correct, r.attempts)),
                          },
                        ]}
                      />
                    )}
                  </Card>
                  <Card title="По темам" note="До 30 тем с наибольшим числом ответов">
                    {d.byTopic.length === 0 ? (
                      <p className={s.muted}>Ответов пока нет.</p>
                    ) : (
                      <DataTable
                        caption="По темам"
                        rowKey={(r) => `${r.subjectId}-${r.topic}`}
                        rows={d.byTopic}
                        columns={[
                          { key: 'topic', label: 'Тема' },
                          {
                            key: 'subjectId',
                            label: 'Предмет',
                            render: (r) => subjectName(r.subjectId),
                          },
                          { key: 'attempts', label: 'Ответов', numeric: true },
                          {
                            key: 'acc',
                            label: 'Точность',
                            numeric: true,
                            render: (r) => pct(ratio(r.correct, r.attempts)),
                          },
                        ]}
                      />
                    )}
                  </Card>
                  <Card title="Частые ошибки" note="До 20 заданий с наибольшим числом ошибок">
                    {d.mistakes.length === 0 ? (
                      <p className={s.muted}>Ошибок нет.</p>
                    ) : (
                      <DataTable
                        caption="Частые ошибки"
                        rowKey={(r) => r.taskId}
                        rows={d.mistakes}
                        columns={[
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
                          {
                            key: 'subjectId',
                            label: 'Предмет',
                            render: (r) => subjectName(r.subjectId),
                          },
                          { key: 'taskNumber', label: '№', numeric: true },
                          { key: 'timesWrong', label: 'Ошибок', numeric: true },
                          {
                            key: 'status',
                            label: 'Статус',
                            render: (r) =>
                              r.status === 'resolved' ? (
                                <Badge tone="good">Исправлена</Badge>
                              ) : (
                                <Badge tone="warn">Открыта</Badge>
                              ),
                          },
                          {
                            key: 'updatedAt',
                            label: 'Обновлено',
                            render: (r) => date(r.updatedAt),
                          },
                        ]}
                      />
                    )}
                  </Card>
                </div>
                <Card title="История ответов" note="Последние 50">
                  {d.history.length === 0 ? (
                    <p className={s.muted}>Ответов пока нет.</p>
                  ) : (
                    <DataTable
                      caption="История ответов"
                      rowKey={(r) => r.id}
                      rows={d.history}
                      columns={[
                        { key: 'createdAt', label: 'Дата', render: (r) => dateTime(r.createdAt) },
                        {
                          key: 'subjectId',
                          label: 'Предмет',
                          render: (r) => subjectName(r.subjectId),
                        },
                        {
                          key: 'taskNumber',
                          label: '№',
                          render: (r) => (
                            <AdminLink to={`/admin/content/tasks/${r.taskId}`} className={s.link}>
                              {r.taskNumber ?? '—'}
                            </AdminLink>
                          ),
                        },
                        {
                          key: 'correct',
                          label: 'Результат',
                          render: (r) =>
                            r.correct ? (
                              <Badge tone="good">Верно</Badge>
                            ) : (
                              <Badge tone="bad">Неверно</Badge>
                            ),
                        },
                        {
                          key: 'timeSpentMs',
                          label: 'Время',
                          numeric: true,
                          render: (r) => seconds(r.timeSpentMs),
                        },
                      ]}
                    />
                  )}
                </Card>
                <Card title="Жалобы пользователя">
                  {d.complaints.length === 0 ? (
                    <p className={s.muted}>Жалоб нет.</p>
                  ) : (
                    <DataTable
                      caption="Жалобы пользователя"
                      rowKey={(r) => r.id}
                      rows={d.complaints}
                      columns={[
                        {
                          key: 'id',
                          label: 'Жалоба',
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
                        {
                          key: 'reason',
                          label: 'Причина',
                          render: (r) => complaintReasonText[r.reason] ?? r.reason,
                        },
                        {
                          key: 'status',
                          label: 'Статус',
                          render: (r) => complaintStatusText[r.status] ?? r.status,
                        },
                      ]}
                    />
                  )}
                </Card>
              </div>
              <ConfirmDialog
                open={confirmOpen}
                title="Завершить все сессии?"
                confirmLabel="Завершить сессии"
                danger
                onConfirm={revoke}
                onClose={() => setConfirmOpen(false)}
              >
                Пользователь выйдет из аккаунта на всех устройствах ({num(d.activeSessions)}{' '}
                активных сессий) и должен будет войти снова. Данные и прогресс не удаляются.
                Действие записывается в журнал.
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
