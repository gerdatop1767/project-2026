import { useState, type FormEvent } from 'react';
import { LineSeriesChart, type ChartRow } from '../components/charts.js';
import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
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
  ValueOrNoData,
  type Column,
} from '../components/ui.js';
import { AdminApiError, adminApi, toSearch } from '../adminApi.js';
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
  taskStatusText,
} from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

// ── Response shapes (apps/api/src/modules/admin/reports/content.ts) ─────

type SubjectRow = {
  subjectId: string;
  name: string;
  tasks: number;
  published: number;
  attempts: number;
  correct: number;
  uniqueSolvers: number;
  guestChecks: number;
  openComplaints: number;
};

interface SubjectsResponse {
  period: PeriodInfo;
  items: SubjectRow[];
}

type TaskListRow = {
  id: string;
  subjectId: string;
  taskNumber: number;
  status: string;
  source: string | null;
  sourceYear: number | null;
  updatedAt: string;
  preview: string;
  attempts: number;
  correct: number;
  incorrect: number;
  uniqueSolvers: number;
  solved: number;
  complaints: number;
};

interface TasksResponse {
  period: PeriodInfo;
  total: number;
  page: number;
  pageSize: number;
  items: TaskListRow[];
}

type NumberRow = {
  taskNumber: number;
  tasks: number;
  attempts: number;
  correct: number;
  incorrect: number;
  uniqueSolvers: number;
  solved: number;
  openComplaints: number;
};

type TopRow = {
  id: string;
  taskNumber: number;
  status: string;
  preview: string;
  attempts: number;
  correct: number;
  incorrect: number;
  uniqueSolvers: number;
  solved: number;
  complaints: number;
};

interface SubjectDetail {
  period: PeriodInfo;
  subject: { id: string; name: string };
  minSample: number;
  totals: {
    attempts: number;
    correct: number;
    incorrect: number;
    uniqueSolvers: number;
    solvedPairs: number;
    userTaskPairs: number;
    accuracy: number | null;
    averageAttemptsPerTask: number | null;
    repeats: number;
  };
  daily: { day: string; attempts: number; correct: number }[];
  byNumber: NumberRow[];
  top: { popular: TopRow[]; hardest: TopRow[]; complained: TopRow[] };
}

interface TaskStats {
  attempts: number;
  correct: number;
  incorrect: number;
  uniqueSolvers: number;
  solved: number;
}

type TaskStatus = 'draft' | 'published' | 'archived' | 'needs_review';

interface TaskCard {
  period: PeriodInfo;
  task: {
    id: string;
    subjectId: string;
    subjectName: string;
    taskNumber: number;
    difficulty: number;
    status: TaskStatus;
    answerType: string;
    conditionMd: string;
    correctAnswer: string;
    correctAnswerDisplay: string | null;
    explanationMd: string | null;
    hintMd: string | null;
    imageUrl: string | null;
    source: string | null;
    sourceUrl: string | null;
    sourceYear: number | null;
    sourceDocument: string | null;
    sourceVariant: string | null;
    sourcePage: number | string | null;
    topicName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  stats: { period: TaskStats; allTime: TaskStats };
  guest: { checks: number; correct: number; started: number };
  complaints: {
    id: string;
    reason: string;
    status: string;
    comment: string | null;
    createdAt: string;
  }[];
  history: {
    id: string;
    action: string;
    result: string;
    details: Record<string, unknown> | null;
    createdAt: string;
  }[];
  variants: { title: string; collection: string; position: number }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

const statusTone: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  published: 'good',
  needs_review: 'warn',
  archived: 'neutral',
  draft: 'info',
};

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? 'neutral'}>{taskStatusText[status] ?? status}</Badge>;
}

const answerTypeText: Record<string, string> = {
  short_answer: 'Краткий ответ',
  multiple_choice: 'Выбор вариантов',
  interval: 'Интервал',
  multi_part: 'Ответ из нескольких частей',
  essay: 'Развёрнутый ответ',
};

const subjectName = (id: string) => subjectNames[id] ?? id;

function isNotFound(error: unknown) {
  return error instanceof AdminApiError && error.status === 404;
}

/** Period params to carry into in-admin links, so a drill-down keeps the same period. */
function periodSearch(q: ReturnType<typeof usePeriodQuery>) {
  return { period: q.period, from: q.from, to: q.to };
}

/** Only http(s) / same-origin URLs become links; anything else stays plain text. */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : null;
}

function NotFoundState({ text }: { text: string }) {
  return (
    <div className={s.state}>
      <p>{text}</p>
      <AdminLink className={s.button} to="/admin/content">
        К списку заданий
      </AdminLink>
    </div>
  );
}

// ── «Задания и предметы» ───────────────────────────────────────────────

const sortDefaults: Record<string, 'asc' | 'desc'> = {
  number: 'asc',
  attempts: 'desc',
  accuracy: 'asc',
  complaints: 'desc',
  updated: 'desc',
};

export function ContentPage() {
  const { location, setParams } = useAdminRouter();
  const p = location.params;
  const q = usePeriodQuery();
  const subjects = useAdminQuery<SubjectsResponse>('/content/subjects', q);

  const filters = {
    subject: p.get('subject') ?? undefined,
    number: p.get('number') ?? undefined,
    status: p.get('status') ?? undefined,
    q: p.get('q') ?? undefined,
    sort: p.get('sort') ?? 'number',
    dir: p.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const),
    page: Math.max(1, Number(p.get('page')) || 1),
  };
  const tasks = useAdminQuery<TasksResponse>('/content/tasks', {
    ...q,
    ...filters,
    pageSize: 25,
  });
  const [search, setSearch] = useState(filters.q ?? '');
  const [number, setNumber] = useState(filters.number ?? '');

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setParams({ q: search.trim() || null, number: number || null, page: null });
  };
  const link = (path: string) => `${path}${toSearch(periodSearch(q))}`;

  const subjectColumns: Column<SubjectRow>[] = [
    {
      key: 'name',
      label: 'Предмет',
      render: (r) => (
        <AdminLink className={s.link} to={link(`/admin/content/subjects/${r.subjectId}`)}>
          {r.name}
        </AdminLink>
      ),
    },
    { key: 'tasks', label: 'Заданий', numeric: true },
    { key: 'published', label: 'Опубликовано', numeric: true },
    { key: 'attempts', label: 'Ответов', numeric: true },
    {
      key: 'acc',
      label: 'Верно',
      numeric: true,
      render: (r) => pct(ratio(r.correct, r.attempts)),
    },
    { key: 'uniqueSolvers', label: 'Решающих', numeric: true },
    { key: 'guestChecks', label: 'Проверок гостей', numeric: true },
    { key: 'openComplaints', label: 'Открытых жалоб', numeric: true },
  ];

  const taskColumns: Column<TaskListRow>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (r) => (
        <AdminLink
          className={`${s.link} ${s.mono}`}
          to={link(`/admin/content/tasks/${r.id}`)}
          title={r.preview}
        >
          {r.id.slice(0, 8)}
        </AdminLink>
      ),
    },
    { key: 'subjectId', label: 'Предмет', render: (r) => subjectName(r.subjectId) },
    { key: 'taskNumber', label: '№', numeric: true, sort: 'number' },
    { key: 'status', label: 'Статус', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'attempts', label: 'Ответов', numeric: true, sort: 'attempts' },
    {
      key: 'accuracy',
      label: 'Верно',
      numeric: true,
      sort: 'accuracy',
      render: (r) => pct(ratio(r.correct, r.attempts)),
    },
    { key: 'uniqueSolvers', label: 'Решающих', numeric: true },
    { key: 'complaints', label: 'Жалоб', numeric: true, sort: 'complaints' },
    {
      key: 'source',
      label: 'Источник / год',
      render: (r) =>
        r.source || r.sourceYear ? (
          [r.source, r.sourceYear].filter(Boolean).join(' · ')
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    { key: 'updatedAt', label: 'Обновлено', sort: 'updated', render: (r) => date(r.updatedAt) },
  ];

  return (
    <>
      <PageHead
        title="Задания и предметы"
        subtitle={subjects.data && <PeriodCaption period={subjects.data.period} />}
        actions={
          <>
            <PeriodPicker />
            <a className={s.button} href={adminApi.exportUrl('subjects', q)} download>
              CSV: предметы
            </a>
            <a className={s.button} href={adminApi.exportUrl('numbers', q)} download>
              CSV: номера
            </a>
          </>
        }
      />
      <div className={s.grid}>
        <Card title="Предметы" note="Ответы зарегистрированных пользователей за период">
          <QueryView
            query={subjects}
            skeleton={200}
            isEmpty={(d) => d.items.length === 0}
            empty="Предметов пока нет."
          >
            {(d) => (
              <DataTable
                caption="Предметы"
                columns={subjectColumns}
                rows={d.items}
                rowKey={(r) => r.subjectId}
              />
            )}
          </QueryView>
        </Card>

        <Card title="Все задания" note="Статистика ответов — за выбранный период">
          <div className={s.filters}>
            <label className={s.field}>
              Предмет
              <select
                className={s.select}
                value={filters.subject ?? ''}
                onChange={(e) => setParams({ subject: e.target.value || null, page: null })}
              >
                <option value="">Все предметы</option>
                {(subjects.data?.items ?? []).map((x) => (
                  <option key={x.subjectId} value={x.subjectId}>
                    {x.name}
                  </option>
                ))}
                {filters.subject &&
                  subjects.data &&
                  !subjects.data.items.some((x) => x.subjectId === filters.subject) && (
                    <option value={filters.subject}>{subjectName(filters.subject)}</option>
                  )}
              </select>
            </label>
            <label className={s.field}>
              Статус
              <select
                className={s.select}
                value={filters.status ?? ''}
                onChange={(e) => setParams({ status: e.target.value || null, page: null })}
              >
                <option value="">Все статусы</option>
                {Object.entries(taskStatusText).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <form className={s.toolbar} onSubmit={submitSearch} role="search">
              <label className={s.field}>
                Номер ЕГЭ
                <input
                  type="number"
                  min={1}
                  max={40}
                  inputMode="numeric"
                  className={s.input}
                  style={{ width: '6rem' }}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </label>
              <label className={s.field}>
                Поиск: начало ID или текст условия
                <input
                  type="search"
                  className={s.input}
                  maxLength={100}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <button type="submit" className={s.button}>
                Найти
              </button>
              {(filters.q || filters.number || filters.subject || filters.status) && (
                <button
                  type="button"
                  className={s.button}
                  onClick={() => {
                    setSearch('');
                    setNumber('');
                    setParams({ q: null, number: null, subject: null, status: null, page: null });
                  }}
                >
                  Сбросить
                </button>
              )}
            </form>
          </div>
          <QueryView
            query={tasks}
            skeleton={400}
            isEmpty={(d) => d.items.length === 0}
            empty="Заданий по этим фильтрам нет."
          >
            {(d) => (
              <>
                <DataTable
                  caption="Задания"
                  columns={taskColumns}
                  rows={d.items}
                  rowKey={(r) => r.id}
                  sort={filters.sort}
                  dir={filters.dir}
                  onSort={(key) =>
                    setParams({
                      sort: key,
                      dir:
                        key === filters.sort
                          ? filters.dir === 'asc'
                            ? 'desc'
                            : 'asc'
                          : (sortDefaults[key] ?? 'asc'),
                      page: null,
                    })
                  }
                />
                <Pager
                  page={d.page}
                  pageSize={d.pageSize}
                  total={d.total}
                  onPage={(page) => setParams({ page: page > 1 ? String(page) : null })}
                />
              </>
            )}
          </QueryView>
        </Card>
      </div>
    </>
  );
}

// ── Предмет ────────────────────────────────────────────────────────────

/** Every Moscow day of the period, so days without answers show as real zeros. */
function fillDays(period: PeriodInfo, daily: SubjectDetail['daily']): ChartRow[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: ChartRow[] = [];
  const cursor = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(`${period.to}T00:00:00Z`);
  while (cursor <= end && out.length < 1200) {
    const day = cursor.toISOString().slice(0, 10);
    const row = byDay.get(day);
    out.push({
      label: bucketLabel(day, 'day'),
      values: { attempts: row?.attempts ?? 0, correct: row?.correct ?? 0 },
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function TopTable({
  rows,
  caption,
  empty,
  link,
}: {
  rows: TopRow[];
  caption: string;
  empty: string;
  link: (path: string) => string;
}) {
  if (rows.length === 0) return <p className={s.muted}>{empty}</p>;
  const columns: Column<TopRow>[] = [
    {
      key: 'task',
      label: 'Задание',
      render: (r) => (
        <AdminLink className={s.link} to={link(`/admin/content/tasks/${r.id}`)} title={r.preview}>
          №{r.taskNumber} · <span className={s.mono}>{r.id.slice(0, 8)}</span>
        </AdminLink>
      ),
    },
    { key: 'attempts', label: 'Ответов', numeric: true },
    {
      key: 'acc',
      label: 'Верно',
      numeric: true,
      render: (r) => pct(ratio(r.correct, r.attempts)),
    },
    { key: 'complaints', label: 'Жалоб', numeric: true },
  ];
  return <DataTable caption={caption} columns={columns} rows={rows} rowKey={(r) => r.id} />;
}

export function SubjectPage({ id = '' }: { id?: string }) {
  const q = usePeriodQuery();
  const query = useAdminQuery<SubjectDetail>(`/content/subjects/${encodeURIComponent(id)}`, q);
  const link = (path: string) => `${path}${toSearch(periodSearch(q))}`;

  if (!query.data && query.status === 'error' && isNotFound(query.error)) {
    return (
      <>
        <AdminLink className={`${s.link} ${s.backLink}`} to="/admin/content">
          ← Задания и предметы
        </AdminLink>
        <NotFoundState text="Предмет не найден" />
      </>
    );
  }

  return (
    <>
      <AdminLink className={`${s.link} ${s.backLink}`} to={link('/admin/content')}>
        ← Задания и предметы
      </AdminLink>
      <PageHead
        title={query.data?.subject.name ?? subjectName(id)}
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
      <QueryView query={query} skeleton={420}>
        {(d) => {
          const t = d.totals;
          const numberColumns: Column<NumberRow>[] = [
            {
              key: 'taskNumber',
              label: '№',
              render: (r) => (
                <AdminLink
                  className={s.link}
                  to={`/admin/content${toSearch({ ...periodSearch(q), subject: d.subject.id, number: r.taskNumber })}`}
                >
                  №{r.taskNumber}
                </AdminLink>
              ),
            },
            { key: 'tasks', label: 'Заданий', numeric: true },
            { key: 'attempts', label: 'Ответов', numeric: true },
            {
              key: 'acc',
              label: 'Верно',
              numeric: true,
              render: (r) => pct(ratio(r.correct, r.attempts)),
            },
            { key: 'incorrect', label: 'Неверных', numeric: true },
            { key: 'uniqueSolvers', label: 'Решающих', numeric: true },
            { key: 'solved', label: 'Решили', numeric: true },
            { key: 'openComplaints', label: 'Открытых жалоб', numeric: true },
          ];
          return (
            <>
              <div className={s.kpis}>
                <Kpi label="Ответов" value={t.attempts} />
                <Kpi label="Верных" value={t.correct} />
                <Kpi label="Неверных" value={t.incorrect} />
                <Kpi label="Точность" value={t.accuracy} format={(v) => pct(v)} />
                <Kpi label="Уникальные решающие" value={t.uniqueSolvers} />
                <Kpi
                  label="Решённые пары «ученик–задание»"
                  value={t.solvedPairs}
                  hint={`из ${num(t.userTaskPairs)} начатых`}
                />
                <Kpi
                  label="Попыток на задание"
                  value={t.averageAttemptsPerTask}
                  format={(v) =>
                    v === null || v === undefined ? num(v) : v.toFixed(2).replace('.', ',')
                  }
                  hint="в среднем на пару «ученик–задание»"
                />
                <Kpi
                  label="Повторные попытки"
                  value={t.repeats}
                  hint="ответы сверх первого на то же задание"
                />
              </div>
              <div className={s.grid}>
                <Card title="Ответы по дням" note="Зарегистрированные пользователи, дни по Москве">
                  {t.attempts === 0 ? (
                    <p className={s.muted}>За период ответов не было.</p>
                  ) : (
                    <LineSeriesChart
                      title="Ответы и верные ответы по дням"
                      series={[
                        { key: 'attempts', label: 'Все ответы', color: 'var(--admin-s1)' },
                        { key: 'correct', label: 'Верные', color: 'var(--color-success)' },
                      ]}
                      rows={fillDays(d.period, d.daily)}
                    />
                  )}
                </Card>
                <Card title="По номерам ЕГЭ" note="Номер открывает список заданий с этим номером">
                  {d.byNumber.length === 0 ? (
                    <p className={s.muted}>В предмете пока нет заданий.</p>
                  ) : (
                    <DataTable
                      caption="Статистика по номерам ЕГЭ"
                      columns={numberColumns}
                      rows={d.byNumber}
                      rowKey={(r) => String(r.taskNumber)}
                    />
                  )}
                </Card>
                <div className={s.cols3}>
                  <Card title="Популярные" note="Больше всего ответов за период">
                    <TopTable
                      rows={d.top.popular}
                      caption="Популярные задания"
                      empty="За период ответов не было."
                      link={link}
                    />
                  </Card>
                  <Card
                    title="Сложные"
                    note={`Только задания с ≥ ${d.minSample} ответами; сложное ≠ ошибочное`}
                  >
                    <TopTable
                      rows={d.top.hardest}
                      caption="Сложные задания"
                      empty="Нет заданий с достаточной выборкой."
                      link={link}
                    />
                  </Card>
                  <Card title="С жалобами" note="Все жалобы за всё время">
                    <TopTable
                      rows={d.top.complained}
                      caption="Задания с жалобами"
                      empty="Жалоб нет."
                      link={link}
                    />
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </QueryView>
    </>
  );
}

// ── Задание ────────────────────────────────────────────────────────────

const statusActions: {
  status: TaskStatus;
  label: string;
  confirm: string;
  impact: string;
  danger: boolean;
}[] = [
  {
    status: 'published',
    label: 'Опубликовать',
    confirm: 'Опубликовать',
    impact:
      'Задание станет доступно ученикам в тренировках, ошибках и вариантах. Убедитесь, что ответ и разбор проверены.',
    danger: false,
  },
  {
    status: 'archived',
    label: 'Скрыть',
    confirm: 'Скрыть задание',
    impact:
      'Задание перестанет показываться ученикам. История их ответов и статистика сохранятся; вернуть можно в любой момент.',
    danger: true,
  },
  {
    status: 'needs_review',
    label: 'Нужна проверка',
    confirm: 'Отправить на проверку',
    impact:
      'Задание скроется от учеников, пока его не проверят и не опубликуют снова. История ответов сохранится.',
    danger: true,
  },
  {
    status: 'draft',
    label: 'В черновики',
    confirm: 'Перевести в черновик',
    impact: 'Задание скроется от учеников и станет черновиком. История ответов сохранится.',
    danger: true,
  },
];

function StatsTable({ stats }: { stats: TaskCard['stats'] }) {
  const rows: [string, (x: TaskStats) => string][] = [
    ['Ответов', (x) => num(x.attempts)],
    ['Верных', (x) => num(x.correct)],
    ['Неверных', (x) => num(x.incorrect)],
    ['Точность', (x) => pct(ratio(x.correct, x.attempts))],
    ['Уникальные решающие', (x) => num(x.uniqueSolvers)],
    ['Решили (≥1 верный)', (x) => num(x.solved)],
  ];
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className={s.srOnly}>Статистика задания</caption>
        <thead>
          <tr>
            <th scope="col">Показатель</th>
            <th scope="col" className={s.num}>
              За период
            </th>
            <th scope="col" className={s.num}>
              За всё время
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className={s.num}>{f(stats.period)}</td>
              <td className={s.num}>{f(stats.allTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function historyText(entry: TaskCard['history'][number]): string {
  const d = entry.details;
  if (entry.action === 'task.status_changed' && d) {
    const from = typeof d.from === 'string' ? (taskStatusText[d.from] ?? d.from) : '?';
    const to = typeof d.to === 'string' ? (taskStatusText[d.to] ?? d.to) : '?';
    return `Статус: ${from} → ${to}`;
  }
  return d ? `${entry.action} · ${JSON.stringify(d)}` : entry.action;
}

function TextBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <h3 className={s.cardTitle}>{label}</h3>
      {text && text.trim() ? (
        <div className={s.preview}>{text}</div>
      ) : (
        <p className={s.muted}>Нет</p>
      )}
    </div>
  );
}

export function TaskPage({ id = '' }: { id?: string }) {
  const q = usePeriodQuery();
  const query = useAdminQuery<TaskCard>(`/content/tasks/${encodeURIComponent(id)}`, q);
  const [pending, setPending] = useState<(typeof statusActions)[number] | null>(null);

  if (!query.data && query.status === 'error' && isNotFound(query.error)) {
    return (
      <>
        <AdminLink className={`${s.link} ${s.backLink}`} to="/admin/content">
          ← Задания и предметы
        </AdminLink>
        <NotFoundState text="Задание не найдено" />
      </>
    );
  }

  return (
    <>
      <AdminLink
        className={`${s.link} ${s.backLink}`}
        to={`/admin/content${toSearch(periodSearch(q))}`}
      >
        ← Задания и предметы
      </AdminLink>
      <PageHead
        title={
          query.data ? `${query.data.task.subjectName} · №${query.data.task.taskNumber}` : 'Задание'
        }
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
      <QueryView query={query} skeleton={480}>
        {(d) => {
          const t = d.task;
          const sourceHref = safeHref(t.sourceUrl);
          const imageHref = safeHref(t.imageUrl);
          return (
            <div className={s.grid}>
              <Card
                title="Статус"
                actions={<StatusBadge status={t.status} />}
                note="Меняет, видят ли задание ученики. Каждое изменение записывается в журнал."
              >
                <div className={s.toolbar}>
                  {statusActions
                    .filter((a) => a.status !== t.status)
                    .map((a) => (
                      <button
                        key={a.status}
                        type="button"
                        className={`${s.button} ${a.status === 'published' ? s.buttonPrimary : ''}`}
                        onClick={() => setPending(a)}
                      >
                        {a.label}
                      </button>
                    ))}
                </div>
                <Note>
                  Редактора заданий в проекте пока нет — текст, ответ и разбор меняются через импорт
                  контента.
                </Note>
              </Card>
              <ConfirmDialog
                open={pending !== null}
                title={pending ? `${pending.label}: задание №${t.taskNumber}?` : ''}
                confirmLabel={pending?.confirm ?? ''}
                danger={pending?.danger}
                onClose={() => setPending(null)}
                onConfirm={async () => {
                  if (!pending) return;
                  await adminApi.post(`/content/tasks/${encodeURIComponent(t.id)}/status`, {
                    status: pending.status,
                    confirm: true,
                  });
                  query.reload();
                }}
              >
                <p>
                  Сейчас: {taskStatusText[t.status] ?? t.status} → станет:{' '}
                  {pending ? (taskStatusText[pending.status] ?? pending.status) : ''}.
                </p>
                <p>{pending?.impact}</p>
              </ConfirmDialog>

              <div className={s.cols2}>
                <Card title="Сведения">
                  <dl className={s.dl}>
                    <dt>ID</dt>
                    <dd className={s.mono}>{t.id}</dd>
                    <dt>Предмет</dt>
                    <dd>
                      <AdminLink
                        className={s.link}
                        to={`/admin/content/subjects/${t.subjectId}${toSearch(periodSearch(q))}`}
                      >
                        {t.subjectName}
                      </AdminLink>
                    </dd>
                    <dt>Номер ЕГЭ</dt>
                    <dd>№{t.taskNumber}</dd>
                    <dt>Тема</dt>
                    <dd>
                      <ValueOrNoData value={t.topicName} />
                    </dd>
                    <dt>Сложность</dt>
                    <dd>{num(t.difficulty)}</dd>
                    <dt>Тип ответа</dt>
                    <dd>{answerTypeText[t.answerType] ?? t.answerType}</dd>
                    <dt>Источник</dt>
                    <dd>
                      {sourceHref ? (
                        <a
                          className={s.link}
                          href={sourceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t.source ?? sourceHref}
                        </a>
                      ) : (
                        <ValueOrNoData value={t.source} />
                      )}
                    </dd>
                    <dt>Год</dt>
                    <dd>
                      <ValueOrNoData value={t.sourceYear} />
                    </dd>
                    <dt>Документ / вариант / стр.</dt>
                    <dd>
                      {[t.sourceDocument, t.sourceVariant, t.sourcePage]
                        .filter((x) => x !== null && x !== '')
                        .join(' · ') || <span className={s.muted}>—</span>}
                    </dd>
                    <dt>Изображение</dt>
                    <dd>
                      {imageHref ? (
                        <a
                          className={s.link}
                          href={imageHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          открыть
                        </a>
                      ) : (
                        <span className={s.muted}>нет</span>
                      )}
                    </dd>
                    <dt>Создано</dt>
                    <dd>{dateTime(t.createdAt)}</dd>
                    <dt>Обновлено</dt>
                    <dd>{dateTime(t.updatedAt)}</dd>
                  </dl>
                </Card>
                <Card title="Статистика" note="Ответы зарегистрированных пользователей">
                  <StatsTable stats={d.stats} />
                  <h3 className={s.cardTitle} style={{ marginTop: 'var(--space-4)' }}>
                    Гости (за всё время сбора событий)
                  </h3>
                  <dl className={s.dl}>
                    <dt>Проверок ответа</dt>
                    <dd>{num(d.guest.checks)}</dd>
                    <dt>Из них верных</dt>
                    <dd>
                      {num(d.guest.correct)} ({pct(ratio(d.guest.correct, d.guest.checks))})
                    </dd>
                    <dt>Открытий задания</dt>
                    <dd>{num(d.guest.started)}</dd>
                  </dl>
                </Card>
              </div>

              <Card
                title="Содержание"
                note="Показано как исходный текст, без оформления формул и разметки"
              >
                <div className={s.grid}>
                  <TextBlock label="Условие" text={t.conditionMd} />
                  <div>
                    <h3 className={s.cardTitle}>Правильный ответ</h3>
                    {t.correctAnswer ? (
                      <div className={`${s.preview} ${s.mono}`}>{t.correctAnswer}</div>
                    ) : (
                      <p className={s.muted}>
                        {t.answerType === 'essay'
                          ? 'Нет — развёрнутый ответ не проверяется автоматически'
                          : 'Не задан'}
                      </p>
                    )}
                    {t.correctAnswerDisplay && (
                      <p className={s.small}>
                        Как показывается ученику:{' '}
                        <span className={s.mono}>{t.correctAnswerDisplay}</span>
                      </p>
                    )}
                  </div>
                  <TextBlock label="Разбор" text={t.explanationMd} />
                  <TextBlock label="Подсказка" text={t.hintMd} />
                </div>
              </Card>

              <div className={s.cols2}>
                <Card title="Варианты" note="Сборники и варианты, в которые входит задание">
                  {d.variants.length === 0 ? (
                    <p className={s.muted}>Задание не входит ни в один вариант.</p>
                  ) : (
                    <ul className={s.small}>
                      {d.variants.map((v) => (
                        <li key={`${v.collection}|${v.title}|${v.position}`}>
                          {v.collection} · {v.title} · позиция {v.position}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Жалобы" note="Последние 50">
                  {d.complaints.length === 0 ? (
                    <p className={s.muted}>Жалоб нет.</p>
                  ) : (
                    <ul
                      className={s.grid}
                      style={{ listStyle: 'none', padding: 0, gap: 'var(--space-2)' }}
                    >
                      {d.complaints.map((c) => (
                        <li key={c.id}>
                          <AdminLink className={s.link} to={`/admin/complaints/${c.id}`}>
                            {complaintReasonText[c.reason] ?? c.reason}
                          </AdminLink>{' '}
                          <Badge
                            tone={
                              c.status === 'new'
                                ? 'warn'
                                : c.status === 'fixed'
                                  ? 'good'
                                  : 'neutral'
                            }
                          >
                            {complaintStatusText[c.status] ?? c.status}
                          </Badge>{' '}
                          <span className={s.muted}>{dateTime(c.createdAt)}</span>
                          {c.comment && <div className={s.small}>{c.comment}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title="История изменений" note="Действия в админке с этим заданием">
                {d.history.length === 0 ? (
                  <p className={s.muted}>Изменений через админку не было.</p>
                ) : (
                  <ul className={s.small} style={{ paddingLeft: '1.25rem' }}>
                    {d.history.map((h) => (
                      <li key={h.id}>
                        <span className={s.muted}>{dateTime(h.createdAt)}</span> ·{' '}
                        <span>{historyText(h)}</span>
                        {h.result !== 'ok' && <> · {h.result}</>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
