import { useState, type FormEvent } from 'react';
import { PeriodPicker, usePeriodQuery } from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import {
  Badge,
  Card,
  DataTable,
  ErrorState,
  Note,
  Pager,
  QueryView,
  Segmented,
  type Column,
} from '../components/ui.js';
import { adminApi } from '../adminApi.js';
import { dateTime, num } from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

// ── Types (shapes of apps/api admin routes) ─────────────────────────────

type AuditItem = {
  id: string;
  actorUserId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  result: 'ok' | 'denied' | 'error';
  details: unknown;
  createdAt: string;
};

interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  items: AuditItem[];
}

interface AdminSettings {
  quality: {
    minSample: number;
    lowAccuracy: number;
    accuracyDrop: number;
    complaints: number;
    abandonment: number;
  };
  alerts: {
    solvesDropShare: number;
    solvesMinDaily: number;
    errorRate: number;
    errorMinRequests: number;
    complaintsFactor: number;
    complaintsMin: number;
    accuracyShift: number;
    accuracyMinAnswers: number;
    authFailureRate: number;
    authMinRequests: number;
  };
}

type ConnectionState = 'not_connected' | 'connected';

interface SettingsResponse {
  settings: AdminSettings;
  defaults: AdminSettings;
  channels: { telegram: ConnectionState; email: ConnectionState };
  integrations: { yandexWebmaster: ConnectionState; googleSearchConsole: ConnectionState };
}

// ── Tabs ────────────────────────────────────────────────────────────────

const tabs = [
  { value: 'audit', label: 'Журнал действий' },
  { value: 'settings', label: 'Пороги' },
  { value: 'export', label: 'Выгрузки' },
  { value: 'notifications', label: 'Интеграции' },
] as const;
type Tab = (typeof tabs)[number]['value'];

export function ManagePage() {
  const { location, setParams } = useAdminRouter();
  const raw = location.params.get('tab');
  const tab: Tab = tabs.some((t) => t.value === raw) ? (raw as Tab) : 'audit';
  return (
    <>
      <PageHead title="Управление" />
      <div className={s.grid}>
        <Segmented
          label="Раздел"
          value={tab}
          options={tabs}
          onChange={(v) =>
            setParams({ tab: v === 'audit' ? null : v, page: null, objectType: null, action: null })
          }
        />
        {tab === 'audit' && <AuditSection />}
        {tab === 'settings' && <SettingsSection />}
        {tab === 'export' && <ExportSection />}
        {tab === 'notifications' && <NotificationsSection />}
      </div>
    </>
  );
}

// ── Audit ───────────────────────────────────────────────────────────────

export const auditActionText: Record<string, string> = {
  'admin.access_denied': 'Отказ в доступе',
  'task.status_changed': 'Статус задания изменён',
  'complaint.updated': 'Жалоба обновлена',
  'campaign.created': 'Кампания создана',
  'campaign.status_changed': 'Статус кампании изменён',
  'user.sessions_revoked': 'Сессии пользователя завершены',
  'settings.updated': 'Пороги изменены',
  'export.csv': 'Выгрузка CSV',
};

const objectTypes = [
  { value: 'task', label: 'Задание' },
  { value: 'complaint', label: 'Жалоба' },
  { value: 'campaign', label: 'Кампания' },
  { value: 'user', label: 'Пользователь' },
  { value: 'settings', label: 'Настройки' },
  { value: 'export', label: 'Выгрузка' },
] as const;

const objectHref: Record<string, (id: string) => string> = {
  task: (id) => `/admin/content/tasks/${encodeURIComponent(id)}`,
  complaint: (id) => `/admin/complaints/${encodeURIComponent(id)}`,
  campaign: (id) => `/admin/campaigns/${encodeURIComponent(id)}`,
  user: (id) => `/admin/users/${encodeURIComponent(id)}`,
};

const resultBadge: Record<AuditItem['result'], { tone: 'good' | 'warn' | 'bad'; text: string }> = {
  ok: { tone: 'good', text: 'Успешно' },
  denied: { tone: 'warn', text: 'Отказано' },
  error: { tone: 'bad', text: 'Ошибка' },
};

/** `{"a":1,"b":{"c":2}}` → `a: 1 · b: {c: 2}`, cut to a readable length. */
export function compactDetails(details: unknown, max = 160): string {
  if (details === null || details === undefined) return '—';
  const show = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
    if (typeof v === 'object') {
      return `{${Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => `${k}: ${show(x)}`)
        .join(', ')}}`;
    }
    return String(v);
  };
  const text =
    typeof details === 'object' && !Array.isArray(details)
      ? Object.entries(details as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${show(v)}`)
          .join(' · ')
      : show(details);
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const shortId = (id: string) => id.slice(0, 8);

function AuditSection() {
  const { location, setParams } = useAdminRouter();
  const p = location.params;
  const objectType = p.get('objectType') ?? '';
  const action = p.get('action') ?? '';
  const page = Math.max(1, Number(p.get('page')) || 1);
  const pageSize = 50;
  const [actionDraft, setActionDraft] = useState(action);
  const [draftError, setDraftError] = useState(false);
  const query = useAdminQuery<AuditPage>('/audit', {
    objectType: objectType || undefined,
    action: action || undefined,
    page,
    pageSize,
  });

  const applyAction = (event: FormEvent) => {
    event.preventDefault();
    const value = actionDraft.trim().toLowerCase();
    if (!/^[a-z_.]*$/.test(value)) {
      setDraftError(true);
      return;
    }
    setDraftError(false);
    setParams({ action: value || null, page: null });
  };

  const columns: Column<AuditItem>[] = [
    { key: 'createdAt', label: 'Дата', render: (r) => dateTime(r.createdAt) },
    {
      key: 'actor',
      label: 'Кто',
      render: (r) =>
        r.actorUserId ? (
          <AdminLink
            className={`${s.link} ${s.mono}`}
            to={`/admin/users/${encodeURIComponent(r.actorUserId)}`}
            title={r.actorUserId}
          >
            {shortId(r.actorUserId)}
          </AdminLink>
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    {
      key: 'action',
      label: 'Действие',
      render: (r) => (
        <span title={r.action}>
          {auditActionText[r.action] ?? <span className={s.mono}>{r.action}</span>}
        </span>
      ),
    },
    {
      key: 'object',
      label: 'Объект',
      render: (r) => {
        if (!r.objectType) return <span className={s.muted}>—</span>;
        const typeLabel = objectTypes.find((t) => t.value === r.objectType)?.label ?? r.objectType;
        const href = r.objectId ? objectHref[r.objectType] : undefined;
        return (
          <>
            {typeLabel}
            {r.objectId && (
              <>
                {' '}
                {href ? (
                  <AdminLink
                    className={`${s.link} ${s.mono}`}
                    to={href(r.objectId)}
                    title={r.objectId}
                  >
                    {shortId(r.objectId)}
                  </AdminLink>
                ) : (
                  <span className={s.mono}>{r.objectId}</span>
                )}
              </>
            )}
          </>
        );
      },
    },
    {
      key: 'result',
      label: 'Результат',
      render: (r) => {
        const b = resultBadge[r.result];
        return b ? <Badge tone={b.tone}>{b.text}</Badge> : r.result;
      },
    },
    {
      key: 'details',
      label: 'Подробности',
      render: (r) => <span className={s.small}>{compactDetails(r.details)}</span>,
    },
  ];

  return (
    <Card
      title="Журнал действий"
      note="Все изменения, выгрузки и отказы в доступе. Новые записи сверху."
    >
      <div className={s.filters}>
        <label className={s.field}>
          Объект
          <select
            className={s.select}
            value={objectType}
            onChange={(e) => setParams({ objectType: e.target.value || null, page: null })}
          >
            <option value="">Все</option>
            {objectTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <form className={s.toolbar} onSubmit={applyAction} style={{ alignItems: 'flex-end' }}>
          <label className={s.field}>
            Действие (код)
            <input
              className={s.input}
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              placeholder="campaign.created"
              list="admin-audit-actions"
              aria-invalid={draftError || undefined}
            />
          </label>
          <datalist id="admin-audit-actions">
            {Object.entries(auditActionText).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </datalist>
          <button type="submit" className={s.button}>
            Найти
          </button>
          {action && (
            <button
              type="button"
              className={s.button}
              onClick={() => {
                setActionDraft('');
                setParams({ action: null, page: null });
              }}
            >
              Сбросить
            </button>
          )}
        </form>
      </div>
      {draftError && (
        <p className={s.small} role="alert">
          Код действия — латинские буквы, точка и подчёркивание, например campaign.created.
        </p>
      )}
      <QueryView
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={
          objectType || action ? 'По этим фильтрам записей нет.' : 'В журнале пока нет записей.'
        }
      >
        {(d) => (
          <>
            <DataTable
              caption="Журнал действий"
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
          </>
        )}
      </QueryView>
      <Note>
        Журнал только дополняется: изменить или удалить запись нельзя — это запрещено на уровне базы
        данных.
      </Note>
    </Card>
  );
}

// ── Settings ────────────────────────────────────────────────────────────

type Group = keyof AdminSettings;
interface FieldDef {
  group: Group;
  key: string;
  label: string;
  hint: string;
  /** share: stored 0..1, edited as %; int: whole number; factor: decimal. */
  kind: 'share' | 'int' | 'factor';
  min: number;
  max: number;
}

const fields: FieldDef[] = [
  {
    group: 'quality',
    key: 'minSample',
    label: 'Минимум ответов',
    hint: 'Сколько ответов нужно, прежде чем показывать сигналы по точности задания.',
    kind: 'int',
    min: 5,
    max: 10_000,
  },
  {
    group: 'quality',
    key: 'lowAccuracy',
    label: 'Очень низкая точность, %',
    hint: 'Задание помечается, если верных ответов меньше этой доли.',
    kind: 'share',
    min: 0,
    max: 1,
  },
  {
    group: 'quality',
    key: 'accuracyDrop',
    label: 'Падение точности, п.п.',
    hint: 'Насколько точность должна упасть относительно прошлого периода.',
    kind: 'share',
    min: 0.05,
    max: 1,
  },
  {
    group: 'quality',
    key: 'complaints',
    label: 'Открытых жалоб на задание',
    hint: 'Сколько открытых жалоб достаточно, чтобы пометить задание.',
    kind: 'int',
    min: 1,
    max: 1000,
  },
  {
    group: 'quality',
    key: 'abandonment',
    label: 'Брошенные открытия, %',
    hint: 'Доля открывших задание, но не ответивших (при том же минимуме открытий).',
    kind: 'share',
    min: 0,
    max: 1,
  },
  {
    group: 'alerts',
    key: 'solvesDropShare',
    label: 'Падение ответов, % от среднего',
    hint: 'Оповещение, если ответов за 24 часа меньше этой доли от среднего за 7 дней.',
    kind: 'share',
    min: 0.05,
    max: 1,
  },
  {
    group: 'alerts',
    key: 'solvesMinDaily',
    label: 'Минимум ответов в день',
    hint: 'Среднее за 7 дней, ниже которого падение не проверяется.',
    kind: 'int',
    min: 1,
    max: 100_000,
  },
  {
    group: 'alerts',
    key: 'errorRate',
    label: 'Ошибки сервера, %',
    hint: 'Доля ответов 5xx за последний час.',
    kind: 'share',
    min: 0.001,
    max: 1,
  },
  {
    group: 'alerts',
    key: 'errorMinRequests',
    label: 'Минимум запросов в час',
    hint: 'Меньше запросов — доля ошибок не проверяется.',
    kind: 'int',
    min: 10,
    max: 1_000_000,
  },
  {
    group: 'alerts',
    key: 'complaintsFactor',
    label: 'Всплеск жалоб, раз',
    hint: 'Жалоб за 24 часа во столько раз больше среднего за 30 дней…',
    kind: 'factor',
    min: 1,
    max: 100,
  },
  {
    group: 'alerts',
    key: 'complaintsMin',
    label: 'Всплеск жалоб, не меньше',
    hint: '…и не меньше этого числа.',
    kind: 'int',
    min: 1,
    max: 10_000,
  },
  {
    group: 'alerts',
    key: 'accuracyShift',
    label: 'Сдвиг точности, п.п.',
    hint: 'Точность за 24 часа отличается от точности за 30 дней больше чем на столько.',
    kind: 'share',
    min: 0.05,
    max: 1,
  },
  {
    group: 'alerts',
    key: 'accuracyMinAnswers',
    label: 'Минимум ответов за 24 часа',
    hint: 'Меньше ответов — сдвиг точности не проверяется.',
    kind: 'int',
    min: 10,
    max: 1_000_000,
  },
  {
    group: 'alerts',
    key: 'authFailureRate',
    label: 'Неудачные входы, %',
    hint: 'Доля ошибок входа за последний час.',
    kind: 'share',
    min: 0.01,
    max: 1,
  },
  {
    group: 'alerts',
    key: 'authMinRequests',
    label: 'Минимум попыток входа в час',
    hint: 'Меньше попыток — доля ошибок входа не проверяется.',
    kind: 'int',
    min: 5,
    max: 1_000_000,
  },
];

const fieldId = (f: FieldDef) => `${f.group}.${f.key}`;
const readValue = (settings: AdminSettings, f: FieldDef): number =>
  (settings[f.group] as Record<string, number>)[f.key] ?? 0;

function toDraft(settings: AdminSettings): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const f of fields) {
    const v = readValue(settings, f);
    draft[fieldId(f)] = f.kind === 'share' ? String(Math.round(v * 100 * 1000) / 1000) : String(v);
  }
  return draft;
}

/** Draft → settings, or the list of fields that are not valid numbers in range. */
function fromDraft(
  draft: Record<string, string>,
  base: AdminSettings,
): { settings: AdminSettings; invalid: string[] } {
  const settings: AdminSettings = { quality: { ...base.quality }, alerts: { ...base.alerts } };
  const invalid: string[] = [];
  for (const f of fields) {
    const raw = (draft[fieldId(f)] ?? '').trim().replace(',', '.');
    const n = raw === '' ? NaN : Number(raw);
    const value = f.kind === 'share' ? Math.round(n * 1000) / 100_000 : n;
    const ok =
      Number.isFinite(value) &&
      (f.kind !== 'int' || Number.isInteger(value)) &&
      value >= f.min &&
      value <= f.max;
    if (!ok) invalid.push(f.label);
    else (settings[f.group] as Record<string, number>)[f.key] = value;
  }
  return { settings, invalid };
}

function rangeText(f: FieldDef): string {
  if (f.kind === 'share') return `от ${num(f.min * 100)} до ${num(f.max * 100)}`;
  return `от ${num(f.min)} до ${num(f.max)}`;
}

function SettingsSection() {
  const query = useAdminQuery<SettingsResponse>('/settings');
  return (
    <QueryView query={query} skeleton={420}>
      {(d) => <SettingsForm data={d} onSaved={query.reload} />}
    </QueryView>
  );
}

function SettingsForm({ data, onSaved }: { data: SettingsResponse; onSaved: () => void }) {
  const [draft, setDraft] = useState(() => toDraft(data.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const result = fromDraft(draft, data.settings);
    setInvalid(result.invalid);
    if (result.invalid.length > 0) return;
    setBusy(true);
    try {
      await adminApi.put('/settings', result.settings);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const group = (g: Group, title: string, note: string) => (
    <Card title={title} note={note}>
      <div className={s.grid}>
        {fields
          .filter((f) => f.group === g)
          .map((f) => {
            const id = `admin-setting-${g}-${f.key}`;
            return (
              <div key={f.key} className={s.field}>
                <label htmlFor={id}>{f.label}</label>
                <input
                  id={id}
                  className={s.input}
                  type="number"
                  inputMode="decimal"
                  step={f.kind === 'int' ? 1 : 'any'}
                  min={f.kind === 'share' ? f.min * 100 : f.min}
                  max={f.kind === 'share' ? f.max * 100 : f.max}
                  value={draft[fieldId(f)] ?? ''}
                  aria-describedby={`${id}-hint`}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft((prev) => ({ ...prev, [fieldId(f)]: e.target.value }));
                  }}
                  required
                />
                <span id={`${id}-hint`} className={s.small}>
                  {f.hint} Допустимо {rangeText(f)}.
                </span>
              </div>
            );
          })}
      </div>
    </Card>
  );

  return (
    <form className={s.grid} onSubmit={save} noValidate>
      <div className={s.cols2}>
        {group('quality', 'Качество заданий', 'Когда задание попадает в «Качество контента»')}
        {group('alerts', 'Оповещения', 'Когда на «Техническом состоянии» появляется тревога')}
      </div>
      {invalid.length > 0 && (
        <p className={s.note} role="alert">
          Проверьте поля: {invalid.join(', ')}.
        </p>
      )}
      {error !== null && <ErrorState error={error} compact />}
      <div className={s.toolbar}>
        <button type="submit" className={`${s.button} ${s.buttonPrimary}`} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className={s.button}
          disabled={busy}
          onClick={() => {
            setSaved(false);
            setInvalid([]);
            setDraft(toDraft(data.defaults));
          }}
        >
          Сбросить к значениям по умолчанию
        </button>
        <span className={s.small} aria-live="polite">
          {saved && 'Сохранено. Изменение записано в журнал действий.'}
        </span>
      </div>
      <Note>
        «Сбросить» только подставляет значения по умолчанию в форму — чтобы применить их, нажмите
        «Сохранить».
      </Note>
    </form>
  );
}

// ── Export ──────────────────────────────────────────────────────────────

const exportKinds = [
  { kind: 'overview', title: 'Обзор', text: 'Регистрации, активные и ответы по дням периода.' },
  { kind: 'subjects', title: 'Предметы', text: 'Ответы и точность по каждому предмету.' },
  { kind: 'numbers', title: 'Номера заданий', text: 'Показатели по номерам ЕГЭ внутри предметов.' },
  {
    kind: 'users',
    title: 'Пользователи',
    text: 'Id, имя, даты, предметы и итоги решения — без почты и контактов.',
  },
  {
    kind: 'campaigns',
    title: 'Кампании',
    text: 'Переходы, регистрации, конверсия и удержание по ссылкам (включая архив).',
  },
  { kind: 'complaints', title: 'Жалобы', text: 'Жалобы на задания с причинами и статусами.' },
  { kind: 'quality', title: 'Качество', text: 'Задания с сигналами о проблемах и их причины.' },
] as const;

function ExportSection() {
  const q = usePeriodQuery();
  return (
    <Card title="Выгрузки CSV" note="За выбранный период, дни по Москве" actions={<PeriodPicker />}>
      <ul className={s.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {exportKinds.map((k) => (
          <li key={k.kind} className={s.toolbar} style={{ justifyContent: 'space-between' }}>
            <span>
              <strong>{k.title}</strong>
              <br />
              <span className={s.small}>{k.text}</span>
            </span>
            <a className={s.button} href={adminApi.exportUrl(k.kind, q)} download>
              Скачать CSV
            </a>
          </li>
        ))}
      </ul>
      <Note>
        Каждая выгрузка записывается в журнал действий. В файлах нет личных контактных данных — ни
        почты, ни идентификаторов входа.
      </Note>
    </Card>
  );
}

// ── Notifications ───────────────────────────────────────────────────────

const connectionText = (v: ConnectionState | undefined) =>
  v === 'connected' ? 'подключено' : 'не подключено';

function NotificationsSection() {
  const query = useAdminQuery<SettingsResponse>('/settings');
  return (
    <QueryView query={query}>
      {(d) => (
        <div className={s.cols2}>
          <Card title="Уведомления в Telegram">
            <dl className={s.dl}>
              <dt>Telegram-бот</dt>
              <dd>
                <Badge>{connectionText(d.channels.telegram)}</Badge>
              </dd>
              <dt>Почта</dt>
              <dd>
                <Badge>{connectionText(d.channels.email)}</Badge>
              </dd>
            </dl>
            <p className={s.small}>
              Что присылать и кому — в разделе{' '}
              <AdminLink className={s.link} to="/admin/notifications">
                «Уведомления»
              </AdminLink>
              . Тревоги по порогам видны только на странице{' '}
              <AdminLink className={s.link} to="/admin/health">
                «Техническое состояние»
              </AdminLink>
              .
            </p>
          </Card>
          <Card title="Интеграции">
            <dl className={s.dl}>
              <dt>Яндекс Вебмастер</dt>
              <dd>
                <Badge>{connectionText(d.integrations.yandexWebmaster)}</Badge>
              </dd>
              <dt>Google Search Console</dt>
              <dd>
                <Badge>{connectionText(d.integrations.googleSearchConsole)}</Badge>
              </dd>
            </dl>
            <p className={s.small}>
              Данные органического поиска (показы, позиции, визиты) появятся только после
              подключения.
            </p>
          </Card>
          <Card title="Задания">
            <p className={s.small}>
              Статусы и показатели заданий —{' '}
              <AdminLink className={s.link} to="/admin/content">
                в разделе «Задания»
              </AdminLink>
              . Редактора заданий и интерфейса импорта в админке пока нет: импорт выполняется
              скриптами при развёртывании.
            </p>
          </Card>
        </div>
      )}
    </QueryView>
  );
}
