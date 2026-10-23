import { useState, type FormEvent } from 'react';
import { LineSeriesChart } from '../components/charts.js';
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
  ErrorState,
  Kpi,
  Note,
  QueryView,
  type Column,
} from '../components/ui.js';
import { AdminApiError, adminApi } from '../adminApi.js';
import { bucketLabel, dateTime, num, pct } from '../format.js';
import { CopyButton } from '../components/CopyButton.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

type CampaignStatus = 'active' | 'disabled' | 'archived';

interface CampaignLink {
  web: string;
  telegramStartParam: string;
}

type CampaignItem = {
  id: string;
  slug: string;
  name: string;
  source: string;
  channel: string;
  creative: string | null;
  targetPath: string;
  status: CampaignStatus;
  createdAt: string;
  clicks: number;
  uniqueVisitors: number;
  guestAnswered: number;
  registrations: number;
  started: number;
  a1: number;
  a5: number;
  a10: number;
  d7: number;
  d30: number;
  d7eligible: number;
  d30eligible: number;
  conversion: number | null;
  link: CampaignLink;
};

interface CampaignsReport {
  period: PeriodInfo;
  attributionWindowDays: number;
  registrations: {
    total: number;
    attributed: number;
    unknown: number;
    unknownShare: number | null;
  };
  items: CampaignItem[];
  searchIntegrations: {
    yandexWebmaster: 'not_connected' | 'connected';
    googleSearchConsole: 'not_connected' | 'connected';
  };
}

interface CampaignDetail {
  period: PeriodInfo;
  campaign: {
    id: string;
    slug: string;
    name: string;
    source: string;
    channel: string;
    creative: string | null;
    targetPath: string;
    status: CampaignStatus;
    createdAt: string;
  };
  daily: { day: string; clicks: number; uniqueVisitors: number; registrations: number }[];
  link: CampaignLink;
}

/** Entry pages a link may lead to — mirrors CAMPAIGN_TARGET_ROOTS on the server. */
export const campaignTargets = [
  { value: '/', label: 'Главная' },
  { value: '/landing', label: 'Лендинг' },
  { value: '/training', label: 'Тренировка' },
  { value: '/subjects', label: 'Предметы' },
  { value: '/learning', label: 'Обучение' },
  { value: '/topics', label: 'Темы' },
  { value: '/mock-exams', label: 'Пробные варианты' },
  { value: '/help', label: 'Помощь' },
  { value: '/faq', label: 'Частые вопросы' },
] as const;

const statusText: Record<CampaignStatus, string> = {
  active: 'Активна',
  disabled: 'Отключена',
  archived: 'В архиве',
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  const tone = status === 'active' ? 'good' : status === 'disabled' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{statusText[status] ?? status}</Badge>;
}

/** «N из M (x%)», or «ещё рано» while nobody is old enough to count. */
function laterText(value: number, eligible: number): string {
  if (!eligible) return 'ещё рано';
  return `${num(value)} из ${num(eligible)} (${pct(value / eligible)})`;
}

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [channel, setChannel] = useState('');
  const [creative, setCreative] = useState('');
  const [targetPath, setTargetPath] = useState<string>('/');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ name: string; link: CampaignLink } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.post<{ name: string; link: CampaignLink }>('/campaigns', {
        name,
        source,
        channel,
        ...(creative.trim() ? { creative } : {}),
        targetPath,
      });
      setCreated({ name: result.name, link: result.link });
      setName('');
      setSource('');
      setChannel('');
      setCreative('');
      onCreated();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Новая ссылка"
      note="Источник и канал — латиница, кириллица, цифры, пробел, точка, дефис"
    >
      <form className={s.grid} onSubmit={submit}>
        <div className={s.filters}>
          <label className={s.field}>
            Название
            <input
              className={s.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className={s.field}>
            Источник
            <input
              className={s.input}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              maxLength={60}
              placeholder="vk, telegram, school"
              required
            />
          </label>
          <label className={s.field}>
            Канал
            <input
              className={s.input}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              maxLength={60}
              placeholder="post, ads, chat"
              required
            />
          </label>
          <label className={s.field}>
            Креатив (необязательно)
            <input
              className={s.input}
              value={creative}
              onChange={(e) => setCreative(e.target.value)}
              maxLength={120}
            />
          </label>
          <label className={s.field}>
            Куда ведёт
            <select
              className={s.select}
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
            >
              {campaignTargets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} ({t.value})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={s.toolbar}>
          <button type="submit" className={`${s.button} ${s.buttonPrimary}`} disabled={busy}>
            {busy ? 'Создаём…' : 'Создать ссылку'}
          </button>
        </div>
        {error !== null && <ErrorState error={error} compact />}
        {created && (
          <div className={s.note} role="status">
            <span>
              Ссылка для «{created.name}»: <span className={s.mono}>{created.link.web}</span>
              <br />
              Telegram Mini App:{' '}
              <span className={s.mono}>startapp={created.link.telegramStartParam}</span>
            </span>
            <CopyButton text={created.link.web} />
          </div>
        )}
      </form>
    </Card>
  );
}

const compareMetrics: { label: string; value: (c: CampaignItem) => string }[] = [
  { label: 'Переходы', value: (c) => num(c.clicks) },
  { label: 'Уникальные посетители', value: (c) => num(c.uniqueVisitors) },
  { label: 'Регистрации', value: (c) => num(c.registrations) },
  { label: 'Конверсия', value: (c) => pct(c.conversion, 1) },
  { label: 'Первый ответ', value: (c) => num(c.a1) },
  { label: '5 ответов', value: (c) => num(c.a5) },
  { label: '10 ответов', value: (c) => num(c.a10) },
  { label: 'Активны через 7 дней', value: (c) => laterText(c.d7, c.d7eligible) },
  { label: 'Активны через 30 дней', value: (c) => laterText(c.d30, c.d30eligible) },
  { label: 'Гости с ответом', value: (c) => num(c.guestAnswered) },
];

function CompareTable({ items }: { items: CampaignItem[] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className={s.srOnly}>Сравнение кампаний</caption>
        <thead>
          <tr>
            <th scope="col">Показатель</th>
            {items.map((c) => (
              <th key={c.id} scope="col" className={s.num}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {compareMetrics.map((m) => (
            <tr key={m.label}>
              <th scope="row">{m.label}</th>
              {items.map((c) => (
                <td key={c.id} className={s.num}>
                  {m.value(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAX_COMPARE = 3;

function AttributionNote({ windowDays }: { windowDays?: number }) {
  return (
    <Note>
      Как считается атрибуция: первое касание — по cookie браузера в пределах окна
      {windowDays ? ` (${num(windowDays)} дн.)` : ''}. Переход — засчитанное открытие ссылки (боты
      предпросмотра ссылок исключены). Регистрация приписывается кампании, только если ссылку
      открыли в том же браузере. Браузер и Telegram Mini App, а также разные устройства между собой
      не связываются — в таких случаях источник «неизвестно».
    </Note>
  );
}

export function CampaignsPage() {
  const q = usePeriodQuery();
  const { location, setParams } = useAdminRouter();
  const archived = location.params.get('archived') === '1' ? '1' : '0';
  const query = useAdminQuery<CampaignsReport>('/campaigns', { ...q, archived });
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, id],
    );

  return (
    <>
      <PageHead
        title="Кампании и ссылки"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={
          <>
            <PeriodPicker />
            <label className={s.small}>
              <input
                type="checkbox"
                checked={archived === '1'}
                onChange={(e) => setParams({ archived: e.target.checked ? '1' : null })}
              />{' '}
              Показать архив
            </label>
            <a className={s.button} href={adminApi.exportUrl('campaigns', q)} download>
              CSV
            </a>
          </>
        }
      />
      <div className={s.grid}>
        <CreateCampaignForm onCreated={query.reload} />
        <QueryView query={query} skeleton={360}>
          {(d) => {
            const columns: Column<CampaignItem>[] = [
              {
                key: 'pick',
                label: 'Сравнить',
                render: (c) => (
                  <input
                    type="checkbox"
                    aria-label={`Сравнить «${c.name}»`}
                    checked={selected.includes(c.id)}
                    disabled={!selected.includes(c.id) && selected.length >= MAX_COMPARE}
                    onChange={() => toggle(c.id)}
                  />
                ),
              },
              {
                key: 'name',
                label: 'Кампания',
                render: (c) => (
                  <>
                    <AdminLink className={s.link} to={`/admin/campaigns/${c.id}`}>
                      {c.name}
                    </AdminLink>
                    <div className={s.small}>
                      {c.source} · {c.channel}
                      {c.creative ? ` · ${c.creative}` : ''}
                    </div>
                  </>
                ),
              },
              { key: 'status', label: 'Статус', render: (c) => <StatusBadge status={c.status} /> },
              { key: 'clicks', label: 'Переходы', numeric: true },
              { key: 'uniqueVisitors', label: 'Уникальные', numeric: true },
              { key: 'registrations', label: 'Регистрации', numeric: true },
              {
                key: 'conversion',
                label: 'Конверсия',
                numeric: true,
                render: (c) => pct(c.conversion, 1),
              },
              { key: 'a1', label: '1-й ответ', numeric: true },
              { key: 'a5', label: '5 ответов', numeric: true },
              { key: 'a10', label: '10 ответов', numeric: true },
              {
                key: 'd7',
                label: 'D7',
                numeric: true,
                render: (c) => laterText(c.d7, c.d7eligible),
              },
              {
                key: 'd30',
                label: 'D30',
                numeric: true,
                render: (c) => laterText(c.d30, c.d30eligible),
              },
              { key: 'guestAnswered', label: 'Гости с ответом', numeric: true },
              {
                key: 'link',
                label: 'Ссылка',
                render: (c) => (
                  <div className={s.grid}>
                    <CopyButton text={c.link.web} />
                    <span className={`${s.small} ${s.mono}`}>
                      startapp={c.link.telegramStartParam}
                    </span>
                  </div>
                ),
              },
            ];
            const compared = d.items.filter((c) => selected.includes(c.id));
            return (
              <div className={s.grid}>
                <div className={s.kpis}>
                  <Kpi label="Регистрации за период" value={d.registrations.total} />
                  <Kpi label="С известной кампанией" value={d.registrations.attributed} />
                  <Kpi
                    label="Источник неизвестен"
                    value={d.registrations.unknownShare}
                    format={(v) => pct(v)}
                    hint={`${num(d.registrations.unknown)} регистраций`}
                  />
                  <Kpi
                    label="Окно атрибуции"
                    value={d.attributionWindowDays}
                    format={(v) => `${num(v)} дн.`}
                  />
                </div>
                <Card
                  title="Кампании"
                  note={
                    archived === '1'
                      ? 'Включая архивные'
                      : 'Без архивных — включите «Показать архив»'
                  }
                >
                  {d.items.length === 0 ? (
                    <p className={s.muted}>Кампаний пока нет — создайте первую ссылку выше.</p>
                  ) : (
                    <>
                      <p className={s.small}>
                        Отметьте до {MAX_COMPARE} кампаний, чтобы сравнить их ниже.
                      </p>
                      <DataTable
                        caption="Кампании"
                        columns={columns}
                        rows={d.items}
                        rowKey={(c) => c.id}
                      />
                    </>
                  )}
                </Card>
                {compared.length > 0 && (
                  <Card
                    title="Сравнение"
                    actions={
                      <button type="button" className={s.button} onClick={() => setSelected([])}>
                        Сбросить
                      </button>
                    }
                  >
                    <CompareTable items={compared} />
                  </Card>
                )}
                <Card title="Поисковые системы">
                  <dl className={s.dl}>
                    <dt>Яндекс Вебмастер</dt>
                    <dd>
                      {d.searchIntegrations.yandexWebmaster === 'connected'
                        ? 'подключено'
                        : 'не подключено'}
                    </dd>
                    <dt>Google Search Console</dt>
                    <dd>
                      {d.searchIntegrations.googleSearchConsole === 'connected'
                        ? 'подключено'
                        : 'не подключено'}
                    </dd>
                  </dl>
                  <p className={s.small}>
                    Визиты из органического поиска, показы и позиции появятся здесь только после
                    подключения этих сервисов.
                  </p>
                </Card>
                <AttributionNote windowDays={d.attributionWindowDays} />
              </div>
            );
          }}
        </QueryView>
      </div>
    </>
  );
}

const statusActions: Record<
  CampaignStatus,
  { to: CampaignStatus; label: string; danger: boolean }[]
> = {
  active: [
    { to: 'disabled', label: 'Отключить', danger: true },
    { to: 'archived', label: 'В архив', danger: true },
  ],
  disabled: [
    { to: 'active', label: 'Включить', danger: false },
    { to: 'archived', label: 'В архив', danger: true },
  ],
  archived: [{ to: 'active', label: 'Включить', danger: false }],
};

export function CampaignPage({ id = '' }: { id?: string }) {
  const q = usePeriodQuery();
  const query = useAdminQuery<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}`, q);
  const [pending, setPending] = useState<{ to: CampaignStatus; label: string; danger: boolean }>();

  const back = (
    <AdminLink className={`${s.link} ${s.backLink}`} to="/admin/campaigns">
      ← Все кампании
    </AdminLink>
  );

  if (
    query.status === 'error' &&
    query.data === null &&
    query.error instanceof AdminApiError &&
    (query.error.status === 404 || query.error.code === 'invalid_id')
  ) {
    return (
      <>
        {back}
        <div className={s.state}>
          <h1 className={s.title}>Кампания не найдена</h1>
          <p>Возможно, ссылка неверна.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <PageHead
        title={query.data?.campaign.name ?? 'Кампания'}
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={<PeriodPicker />}
      />
      <QueryView query={query} skeleton={360}>
        {(d) => {
          const c = d.campaign;
          const target = campaignTargets.find((t) => t.value === c.targetPath);
          return (
            <div className={s.grid}>
              <div className={s.cols2}>
                <Card
                  title="Кампания"
                  actions={
                    <div className={s.toolbar}>
                      {statusActions[c.status]?.map((a) => (
                        <button
                          key={a.to}
                          type="button"
                          className={`${s.button} ${a.danger ? s.buttonDanger : ''}`}
                          onClick={() => setPending(a)}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <dl className={s.dl}>
                    <dt>Статус</dt>
                    <dd>
                      <StatusBadge status={c.status} />
                    </dd>
                    <dt>Источник</dt>
                    <dd>{c.source}</dd>
                    <dt>Канал</dt>
                    <dd>{c.channel}</dd>
                    <dt>Креатив</dt>
                    <dd>{c.creative || '—'}</dd>
                    <dt>Куда ведёт</dt>
                    <dd>{target ? `${target.label} (${c.targetPath})` : c.targetPath}</dd>
                    <dt>Метка</dt>
                    <dd className={s.mono}>{c.slug}</dd>
                    <dt>Создана</dt>
                    <dd>{dateTime(c.createdAt)}</dd>
                  </dl>
                </Card>
                <Card title="Ссылка">
                  <div className={s.grid}>
                    <span className={s.mono}>{d.link.web}</span>
                    <CopyButton text={d.link.web} />
                    <span className={s.small}>
                      Telegram Mini App: параметр{' '}
                      <span className={s.mono}>startapp={d.link.telegramStartParam}</span>
                    </span>
                    {c.status !== 'active' && (
                      <Note>
                        Ссылка не активна: переходы по ней ведут на главную и не засчитываются.
                      </Note>
                    )}
                  </div>
                </Card>
              </div>
              <Card title="По дням" note="Переходы, уникальные посетители и регистрации (МСК)">
                {d.daily.length === 0 ? (
                  <p className={s.muted}>За период данных нет.</p>
                ) : (
                  <LineSeriesChart
                    title="Кампания по дням"
                    series={[
                      { key: 'clicks', label: 'Переходы', color: 'var(--admin-s1)' },
                      { key: 'uv', label: 'Уникальные посетители', color: 'var(--admin-s2)' },
                      { key: 'reg', label: 'Регистрации', color: 'var(--admin-s3)' },
                    ]}
                    rows={d.daily.map((p) => ({
                      label: bucketLabel(p.day, 'day'),
                      values: { clicks: p.clicks, uv: p.uniqueVisitors, reg: p.registrations },
                    }))}
                  />
                )}
              </Card>
              <AttributionNote />
            </div>
          );
        }}
      </QueryView>
      <ConfirmDialog
        open={pending !== undefined}
        title={pending ? `${pending.label}: ${query.data?.campaign.name ?? ''}` : ''}
        confirmLabel={pending?.label ?? 'Подтвердить'}
        danger={pending?.danger}
        onClose={() => setPending(undefined)}
        onConfirm={async () => {
          if (!pending) return;
          await adminApi.patch(`/campaigns/${encodeURIComponent(id)}/status`, {
            status: pending.to,
            confirm: true,
          });
          query.reload();
        }}
      >
        {pending?.to === 'active' ? (
          <p>Ссылка снова начнёт вести на выбранную страницу и засчитывать переходы.</p>
        ) : (
          <p>
            Отключённая ссылка ведёт людей на главную страницу и перестаёт засчитывать переходы и
            регистрации.
            {pending?.to === 'archived' &&
              ' Кампания пропадёт из основного списка (останется в архиве).'}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
