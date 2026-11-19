import { SEO_INTEGRATION_LABELS, type SeoIntegrationKind } from '@zybrilka/shared';
import { useState, type ReactNode } from 'react';
import { adminApi, errorText } from '../../adminApi.js';
import { CopyButton } from '../../components/CopyButton.js';
import { PageHead } from '../../components/Shell.js';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Note,
  QueryView,
  Segmented,
} from '../../components/ui.js';
import { num } from '../../format.js';
import { AdminLink } from '../../router.js';
import { useAdminQuery } from '../../useAdminQuery.js';
import { NoData, SeoTabs, integrationStatusText } from './common.js';
import s from '../../admin.module.css';

type Row = Record<string, unknown>;
const dt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHead title={title} subtitle={<p className={s.subtitle}>{subtitle}</p>} />
      <SeoTabs />
      {children}
    </>
  );
}

function useAction(reload: () => void) {
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return { msg, act };
}

// ── Внешние площадки ────────────────────────────────────────────────────

interface Post {
  id: string;
  article: string | null;
  articleId: string | null;
  platform: string;
  mode: string;
  status: string;
  title: string | null;
  body: string;
  link: string;
  checklist: string[];
  externalUrl: string | null;
  similarityMax: number | null;
  clicks: number;
  registrations: number;
  error: string | null;
  createdAt: string;
}
interface Platform {
  id: string;
  slug: string;
  name: string;
  mode: string;
  format: string;
  rules: string;
  isActive: boolean;
}

export function SeoExternalPage() {
  const query = useAdminQuery<{ platforms: Platform[]; posts: Post[] }>('/seo/external');
  const { msg, act } = useAction(query.reload);
  const [publish, setPublish] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  return (
    <Page
      title="Внешние площадки"
      subtitle="Адаптированные публикации. Автоматически — только через официальные API (Telegram-канал, VK); остальное готовится для ручной публикации."
    >
      {msg && <Note>{msg}</Note>}
      <QueryView query={query} skeleton={400}>
        {(d) => (
          <>
            <Card title="Площадки">
              <DataTable<Platform & Row>
                caption="Площадки"
                rows={d.platforms as (Platform & Row)[]}
                rowKey={(p) => p.id}
                columns={[
                  { key: 'name', label: 'Площадка', render: (p) => <strong>{p.name}</strong> },
                  {
                    key: 'mode',
                    label: 'Публикация',
                    render: (p) => (
                      <Badge tone={p.mode === 'api' ? 'good' : 'neutral'}>
                        {p.mode === 'api' ? 'через API' : 'вручную'}
                      </Badge>
                    ),
                  },
                  {
                    key: 'format',
                    label: 'Формат',
                    render: (p) => <span className={s.small}>{p.format}</span>,
                  },
                  {
                    key: 'rules',
                    label: 'Правила',
                    render: (p) => <span className={s.small}>{p.rules}</span>,
                  },
                  {
                    key: 'active',
                    label: 'Активна',
                    render: (p) => (
                      <input
                        type="checkbox"
                        aria-label={`Активна: ${p.name}`}
                        checked={p.isActive}
                        onChange={(e) =>
                          void act(() =>
                            adminApi.patch(`/seo/platforms/${p.id}`, {
                              isActive: e.target.checked,
                            }),
                          )
                        }
                      />
                    ),
                  },
                ]}
              />
            </Card>
            {d.posts.length === 0 ? (
              <Card>
                <p className={s.muted}>
                  Публикаций пока нет. Агент готовит их для опубликованных статей (режимы
                  «полуавтоматический» и «автономный»).
                </p>
              </Card>
            ) : (
              d.posts.map((p) => (
                <Card
                  key={p.id}
                  title={`${p.platform}: ${p.article ?? 'статья удалена'}`}
                  note={`${dt(p.createdAt)} · переходов ${num(p.clicks)} · регистраций ${num(p.registrations)}${p.similarityMax !== null ? ` · сходство с другими постами ${p.similarityMax}` : ''}`}
                  actions={
                    <Badge
                      tone={
                        p.status === 'published'
                          ? 'good'
                          : p.status === 'error'
                            ? 'bad'
                            : p.status === 'ready'
                              ? 'info'
                              : 'neutral'
                      }
                    >
                      {p.status}
                    </Badge>
                  }
                >
                  {p.title && (
                    <p>
                      <strong>{p.title}</strong>
                    </p>
                  )}
                  <pre className={s.small} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {p.body}
                  </pre>
                  <p className={s.small}>
                    Ссылка с отслеживанием: <span className={s.mono}>{p.link}</span>
                  </p>
                  {p.checklist.length > 0 && (
                    <ul className={s.small}>
                      {p.checklist.map((c) => (
                        <li key={c}>☐ {c}</li>
                      ))}
                    </ul>
                  )}
                  {p.error && <p className={s.down}>{p.error}</p>}
                  {p.externalUrl && (
                    <p className={s.small}>
                      Опубликовано:{' '}
                      <a className={s.link} href={p.externalUrl} target="_blank" rel="noreferrer">
                        {p.externalUrl}
                      </a>
                    </p>
                  )}
                  <div className={s.toolbar}>
                    <CopyButton
                      text={`${p.title ? `${p.title}\n\n` : ''}${p.body}`}
                      label="Копировать текст"
                    />
                    {p.mode === 'api' && p.status !== 'published' && (
                      <button
                        type="button"
                        className={`${s.button} ${s.buttonPrimary}`}
                        onClick={() => setPublish(p.id)}
                      >
                        Опубликовать через API
                      </button>
                    )}
                    {p.mode === 'manual' && p.status !== 'published' && (
                      <>
                        <input
                          className={s.input}
                          placeholder="URL опубликованного поста"
                          value={urls[p.id] ?? ''}
                          onChange={(e) => setUrls({ ...urls, [p.id]: e.target.value })}
                        />
                        <button
                          type="button"
                          className={s.button}
                          disabled={!/^https?:\/\//.test(urls[p.id] ?? '')}
                          onClick={() =>
                            void act(
                              () =>
                                adminApi.patch(`/seo/external/${p.id}`, {
                                  status: 'published',
                                  externalUrl: urls[p.id],
                                }),
                              'Отмечено как опубликованное.',
                            )
                          }
                        >
                          Отметить опубликованным
                        </button>
                        <button
                          type="button"
                          className={s.button}
                          onClick={() =>
                            void act(() =>
                              adminApi.patch(`/seo/external/${p.id}`, { status: 'rejected' }),
                            )
                          }
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                  </div>
                </Card>
              ))
            )}
          </>
        )}
      </QueryView>
      <ConfirmDialog
        open={publish !== null}
        title="Опубликовать пост?"
        confirmLabel="Опубликовать"
        onClose={() => setPublish(null)}
        onConfirm={async () => {
          await adminApi.post(`/seo/external/${publish}/publish`, { confirm: true });
          query.reload();
        }}
      >
        Пост уйдёт в подключённый канал через официальный API. Повторно этот же пост не публикуется.
      </ConfirmDialog>
    </Page>
  );
}

// ── Семантика и темы ────────────────────────────────────────────────────

interface Keyword {
  id: string;
  query: string;
  cluster: string | null;
  article: string | null;
  articleId: string | null;
  intent: string | null;
  frequency: number | null;
  frequencySource: string | null;
  demandEstimate: number | null;
  competition: number | null;
  positionYandex: number | null;
  positionGoogle: number | null;
  source: string;
}
interface Topic {
  id: string;
  title: string;
  angle: string | null;
  format: string | null;
  subjectId: string | null;
  primaryKeyword: string | null;
  priority: number | null;
  factors: Record<string, number> | null;
  reasoning: string | null;
  status: string;
  source: string;
  articleId: string | null;
}
const intentText: Record<string, string> = {
  informational: 'инфо',
  navigational: 'навиг.',
  transactional: 'транз.',
  commercial: 'комм.',
};

export function SeoKeywordsPage() {
  const [filter, setFilter] = useState<'all' | 'uncovered' | 'covered'>('all');
  const [view, setView] = useState<'keywords' | 'topics' | 'cannibal'>('topics');
  const kw = useAdminQuery<{
    items: Keyword[];
    counts: { total: number; covered: number; clusters: number };
  }>(view === 'keywords' ? '/seo/keywords' : null, { filter, pageSize: 200 });
  const topics = useAdminQuery<{ items: Topic[] }>(view === 'topics' ? '/seo/topics' : null, {
    pageSize: 100,
  });
  const cannibal = useAdminQuery<{
    fromSearch: { query: string; engine: string; pages: string[] }[];
    byKeyword: { a: string; b: string; keywordA: string; keywordB: string; overlap: number }[];
  }>(view === 'cannibal' ? '/seo/keywords/cannibalization' : null);
  const [csv, setCsv] = useState('');
  const { msg, act } = useAction(() => {
    kw.reload();
    topics.reload();
  });
  return (
    <Page
      title="Семантика"
      subtitle="Семантическое ядро, темы с SEO-приоритетом и контроль каннибализации"
    >
      {msg && <Note>{msg}</Note>}
      <Segmented<typeof view>
        label="Раздел"
        value={view}
        onChange={setView}
        options={[
          { value: 'topics', label: 'Темы' },
          { value: 'keywords', label: 'Запросы' },
          { value: 'cannibal', label: 'Каннибализация' },
        ]}
      />
      {view === 'topics' && (
        <QueryView
          query={topics}
          skeleton={300}
          isEmpty={(t) => t.items.length === 0}
          empty="Тем пока нет — их находит агент исследования."
        >
          {(t) => (
            <DataTable<Topic & Row>
              caption="Темы"
              rows={t.items as (Topic & Row)[]}
              rowKey={(x) => x.id}
              columns={[
                {
                  key: 'title',
                  label: 'Тема',
                  render: (x) => (
                    <>
                      <strong>{x.title}</strong>
                      <br />
                      <span className={s.small}>
                        {x.primaryKeyword} · {x.source}
                      </span>
                      {x.reasoning && (
                        <details className={s.small}>
                          <summary>Почему</summary>
                          {x.reasoning}
                          {x.factors && (
                            <p>
                              {Object.entries(x.factors)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' · ')}
                            </p>
                          )}
                        </details>
                      )}
                    </>
                  ),
                },
                {
                  key: 'priority',
                  label: 'Приоритет',
                  numeric: true,
                  render: (x) =>
                    x.priority === null ? (
                      <NoData>не оценена</NoData>
                    ) : (
                      Number(x.priority).toFixed(0)
                    ),
                },
                {
                  key: 'status',
                  label: 'Статус',
                  render: (x) => (
                    <Badge
                      tone={
                        x.status === 'published'
                          ? 'good'
                          : x.status === 'rejected' || x.status === 'duplicate'
                            ? 'neutral'
                            : 'info'
                      }
                    >
                      {x.status}
                    </Badge>
                  ),
                },
                {
                  key: 'act',
                  label: '',
                  render: (x) =>
                    x.articleId ? (
                      <AdminLink to={`/admin/seo/articles/${x.articleId}`} className={s.link}>
                        Статья
                      </AdminLink>
                    ) : x.status === 'rejected' || x.status === 'duplicate' ? (
                      <button
                        type="button"
                        className={s.button}
                        onClick={() =>
                          void act(() => adminApi.patch(`/seo/topics/${x.id}`, { action: 'reset' }))
                        }
                      >
                        Вернуть
                      </button>
                    ) : (
                      <span className={s.toolbar}>
                        <button
                          type="button"
                          className={`${s.button} ${s.buttonPrimary}`}
                          onClick={() =>
                            void act(
                              () => adminApi.patch(`/seo/topics/${x.id}`, { action: 'approve' }),
                              'Тема одобрена — агент напишет статью.',
                            )
                          }
                        >
                          Написать
                        </button>
                        <button
                          type="button"
                          className={s.button}
                          onClick={() =>
                            void act(() =>
                              adminApi.patch(`/seo/topics/${x.id}`, { action: 'reject' }),
                            )
                          }
                        >
                          Отклонить
                        </button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </QueryView>
      )}
      {view === 'keywords' && (
        <>
          <Card
            title="Импорт семантического ядра (CSV)"
            note="Колонки: запрос; частотность; кластер; интент (informational/navigational/transactional/commercial). Разделитель «;» или «,». Частотность из CSV считается реальной (источник «csv»)."
          >
            <textarea
              className={s.textarea}
              rows={4}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={'запрос;частотность;кластер\nзадания егэ по математике;12000;Математика'}
            />
            <div className={s.toolbar}>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV-файл"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsv(await f.text());
                }}
              />
              <button
                type="button"
                className={`${s.button} ${s.buttonPrimary}`}
                disabled={csv.trim().length < 3}
                onClick={() =>
                  void act(async () => {
                    const r = await adminApi.post<{
                      added: number;
                      updated: number;
                      skipped: number;
                    }>('/seo/keywords/import', { csv });
                    setCsv('');
                    return r;
                  }, 'Импорт выполнен.')
                }
              >
                Импортировать
              </button>
            </div>
          </Card>
          <div className={s.filters}>
            <Segmented<typeof filter>
              label="Фильтр"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'uncovered', label: 'Без статьи' },
                { value: 'covered', label: 'Охвачены' },
              ]}
            />
          </div>
          <QueryView
            query={kw}
            skeleton={300}
            isEmpty={(k) => k.items.length === 0}
            empty="Запросов нет."
          >
            {(k) => (
              <>
                <p className={s.small}>
                  Всего {num(k.counts.total)} · охвачено статьями {num(k.counts.covered)} ·
                  кластеров {num(k.counts.clusters)}
                </p>
                <DataTable<Keyword & Row>
                  caption="Запросы"
                  rows={k.items as (Keyword & Row)[]}
                  rowKey={(x) => x.id}
                  columns={[
                    { key: 'query', label: 'Запрос', render: (x) => x.query },
                    { key: 'cluster', label: 'Кластер', render: (x) => x.cluster ?? '—' },
                    {
                      key: 'intent',
                      label: 'Интент',
                      render: (x) => (x.intent ? (intentText[x.intent] ?? x.intent) : '—'),
                    },
                    {
                      key: 'frequency',
                      label: 'Частотность',
                      numeric: true,
                      render: (x) =>
                        x.frequency !== null ? (
                          `${num(x.frequency)} (${x.frequencySource})`
                        ) : x.demandEstimate !== null ? (
                          <NoData>оценка {x.demandEstimate}/10</NoData>
                        ) : (
                          <NoData>—</NoData>
                        ),
                    },
                    {
                      key: 'competition',
                      label: 'Конкуренция',
                      numeric: true,
                      render: (x) => (x.competition !== null ? `${x.competition}/10` : '—'),
                    },
                    {
                      key: 'pos',
                      label: 'Позиция Я / G',
                      numeric: true,
                      render: (x) => `${x.positionYandex ?? '—'} / ${x.positionGoogle ?? '—'}`,
                    },
                    {
                      key: 'article',
                      label: 'Статья',
                      render: (x) =>
                        x.articleId ? (
                          <AdminLink to={`/admin/seo/articles/${x.articleId}`} className={s.link}>
                            {x.article}
                          </AdminLink>
                        ) : (
                          <Badge tone="warn">нет</Badge>
                        ),
                    },
                  ]}
                />
              </>
            )}
          </QueryView>
        </>
      )}
      {view === 'cannibal' && (
        <QueryView query={cannibal} skeleton={200}>
          {(c) => (
            <div className={s.cols2}>
              <Card
                title="По данным поиска"
                note="Один запрос — несколько статей блога в выдаче за 28 дней"
              >
                {c.fromSearch.length === 0 ? (
                  <p className={s.muted}>Не найдено (или нет данных Вебмастера/GSC).</p>
                ) : (
                  <ul className={s.small}>
                    {c.fromSearch.map((x) => (
                      <li key={`${x.engine}${x.query}`}>
                        «{x.query}» ({x.engine}): {x.pages.join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="По ключевым запросам статей" note="Основные запросы почти совпадают">
                {c.byKeyword.length === 0 ? (
                  <p className={s.muted}>Конфликтов нет.</p>
                ) : (
                  <ul className={s.small}>
                    {c.byKeyword.map((x) => (
                      <li key={`${x.a}${x.b}`}>
                        «{x.a}» ↔ «{x.b}» — {x.keywordA} / {x.keywordB} (
                        {Math.round(x.overlap * 100)}%)
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </QueryView>
      )}
    </Page>
  );
}

// ── Конкуренты ──────────────────────────────────────────────────────────

interface Competitor {
  id: string;
  name: string;
  domain: string;
  notes: string | null;
  isActive: boolean;
  analyzedAt: string | null;
  analysis: {
    strongTopics?: string[];
    formats?: string[];
    internalLinking?: string;
    weakSpots?: string[];
    opportunities?: { title: string; why: string }[];
  } | null;
}

export function SeoCompetitorsPage() {
  const query = useAdminQuery<{ items: Competitor[] }>('/seo/competitors');
  const { msg, act } = useAction(query.reload);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  return (
    <Page
      title="Конкуренты"
      subtitle="Еженедельный анализ публичных материалов (через официальный веб-поиск, без копирования текстов)"
    >
      {msg && <Note>{msg}</Note>}
      <Card title="Добавить конкурента">
        <div className={s.toolbar}>
          <input
            className={s.input}
            placeholder="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={s.input}
            placeholder="домен, например example.ru"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button
            type="button"
            className={s.button}
            onClick={() =>
              void act(async () => {
                await adminApi.post('/seo/competitors', { name, domain });
                setName('');
                setDomain('');
              })
            }
          >
            Добавить
          </button>
        </div>
      </Card>
      <QueryView query={query} skeleton={300}>
        {(d) => (
          <div className={s.cols2}>
            {d.items.map((c) => (
              <Card
                key={c.id}
                title={`${c.name} · ${c.domain}`}
                note={c.analyzedAt ? `Анализ: ${dt(c.analyzedAt)}` : 'Ещё не анализировался'}
                actions={
                  <label className={s.switchRow}>
                    <input
                      type="checkbox"
                      checked={c.isActive}
                      onChange={(e) =>
                        void act(() =>
                          adminApi.patch(`/seo/competitors/${c.id}`, {
                            isActive: e.target.checked,
                          }),
                        )
                      }
                    />
                    <span className={s.small}>активен</span>
                  </label>
                }
              >
                {c.notes && <p className={s.small}>{c.notes}</p>}
                {c.analysis ? (
                  <div className={s.small}>
                    <p>
                      <strong>Сильные темы:</strong> {c.analysis.strongTopics?.join('; ') || '—'}
                    </p>
                    <p>
                      <strong>Форматы:</strong> {c.analysis.formats?.join('; ') || '—'}
                    </p>
                    <p>
                      <strong>Перелинковка:</strong> {c.analysis.internalLinking || '—'}
                    </p>
                    <p>
                      <strong>Слабые места:</strong> {c.analysis.weakSpots?.join('; ') || '—'}
                    </p>
                    <p>
                      <strong>Возможности:</strong>
                    </p>
                    <ul>
                      {c.analysis.opportunities?.map((o) => (
                        <li key={o.title}>
                          {o.title} — {o.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className={s.muted}>Анализ появится после недельного цикла.</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </QueryView>
    </Page>
  );
}

// ── Технический SEO ─────────────────────────────────────────────────────

interface Issue {
  id: string;
  code: string;
  url: string;
  severity: string;
  title: string;
  description: string;
  impact: string;
  fix: string;
  autoFixable: boolean;
  status: string;
  lastSeenAt: string;
}
const sevTone: Record<string, 'bad' | 'warn' | 'info' | 'neutral'> = {
  critical: 'bad',
  high: 'bad',
  medium: 'warn',
  low: 'neutral',
};
const sevText: Record<string, string> = {
  critical: 'критично',
  high: 'высокий',
  medium: 'средний',
  low: 'низкий',
};

export function SeoAuditPage() {
  const [status, setStatus] = useState<'open' | 'fixed' | 'ignored'>('open');
  const query = useAdminQuery<{
    lastRun: {
      startedAt: string;
      finishedAt: string | null;
      pagesChecked: number;
      issuesFound: number;
      summary: Record<string, unknown> | null;
    } | null;
    issues: Issue[];
  }>('/seo/audit', { status });
  const { msg, act } = useAction(query.reload);
  return (
    <Page
      title="Технический SEO"
      subtitle="Регулярный аудит: статусы, редиректы, canonical, robots, sitemap, мета, H1, дубли, битые ссылки, вложенность, скорость, микроразметка, alt, индексация"
    >
      {msg && <Note>{msg}</Note>}
      <div className={s.toolbar}>
        <button
          type="button"
          className={`${s.button} ${s.buttonPrimary}`}
          onClick={() =>
            void act(
              () => adminApi.post('/seo/agent/run', { kind: 'technical_audit' }),
              'Аудит поставлен в очередь.',
            )
          }
        >
          Запустить аудит
        </button>
        <Segmented<typeof status>
          label="Статус"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Открытые' },
            { value: 'fixed', label: 'Исправленные' },
            { value: 'ignored', label: 'Игнорируемые' },
          ]}
        />
      </div>
      <QueryView query={query} skeleton={300}>
        {(d) => (
          <>
            <p className={s.small}>
              {d.lastRun
                ? `Последний аудит: ${dt(d.lastRun.startedAt)} · страниц ${d.lastRun.pagesChecked} · проблем ${d.lastRun.issuesFound}${d.lastRun.finishedAt ? '' : ' · выполняется…'}`
                : 'Аудит ещё не запускался.'}
            </p>
            {d.issues.length === 0 ? (
              <Card>
                <p className={s.muted}>Проблем нет.</p>
              </Card>
            ) : (
              <DataTable<Issue & Row>
                caption="Проблемы"
                rows={d.issues as (Issue & Row)[]}
                rowKey={(i) => i.id}
                columns={[
                  {
                    key: 'severity',
                    label: 'Приоритет',
                    render: (i) => (
                      <Badge tone={sevTone[i.severity] ?? 'neutral'}>
                        {sevText[i.severity] ?? i.severity}
                      </Badge>
                    ),
                  },
                  {
                    key: 'title',
                    label: 'Проблема',
                    render: (i) => (
                      <>
                        <strong>{i.title}</strong>
                        <br />
                        <span className={s.small}>{i.description}</span>
                      </>
                    ),
                  },
                  {
                    key: 'url',
                    label: 'URL',
                    render: (i) => (
                      <a
                        className={`${s.link} ${s.small}`}
                        href={i.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {i.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                      </a>
                    ),
                  },
                  {
                    key: 'impact',
                    label: 'Влияние',
                    render: (i) => <span className={s.small}>{i.impact}</span>,
                  },
                  {
                    key: 'fix',
                    label: 'Решение',
                    render: (i) => (
                      <span className={s.small}>
                        {i.fix}
                        {i.autoFixable ? ' (агент исправляет сам)' : ''}
                      </span>
                    ),
                  },
                  {
                    key: 'act',
                    label: '',
                    render: (i) =>
                      i.status === 'open' ? (
                        <span className={s.toolbar}>
                          <button
                            type="button"
                            className={s.button}
                            onClick={() =>
                              void act(() =>
                                adminApi.patch(`/seo/audit/issues/${i.id}`, { status: 'fixed' }),
                              )
                            }
                          >
                            Исправлено
                          </button>
                          <button
                            type="button"
                            className={s.button}
                            onClick={() =>
                              void act(() =>
                                adminApi.patch(`/seo/audit/issues/${i.id}`, { status: 'ignored' }),
                              )
                            }
                          >
                            Игнорировать
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={s.button}
                          onClick={() =>
                            void act(() =>
                              adminApi.patch(`/seo/audit/issues/${i.id}`, { status: 'open' }),
                            )
                          }
                        >
                          Открыть
                        </button>
                      ),
                  },
                ]}
              />
            )}
          </>
        )}
      </QueryView>
    </Page>
  );
}

// ── Журнал обучения ─────────────────────────────────────────────────────

interface Learning {
  id: string;
  at: string;
  kind: string;
  title: string;
  body: string;
  evidence: Record<string, unknown> | null;
  status: string;
  outcome: string | null;
}
const kindText: Record<string, string> = {
  observation: 'Наблюдение',
  pattern: 'Закономерность',
  hypothesis: 'Гипотеза',
  decision: 'Решение',
  strategy_change: 'Изменение стратегии',
  result: 'Результат',
};

export function SeoLearningPage() {
  const query = useAdminQuery<{
    items: Learning[];
    insights: {
      dimension: string;
      value: string;
      sampleSize: number;
      metrics: Record<string, number | null>;
      computedAt: string;
    }[];
  }>('/seo/learning', { pageSize: 100 });
  return (
    <Page
      title="Журнал обучения"
      subtitle="Что агент измерил, какие закономерности нашёл, какие решения принял и что из этого вышло. Все выводы — по реальным метрикам."
    >
      <QueryView query={query} skeleton={300}>
        {(d) => (
          <div className={s.cols2}>
            <Card title="Журнал">
              {d.items.length === 0 ? (
                <p className={s.muted}>Записи появятся после первой недельной стратегии.</p>
              ) : (
                <ul className={s.grid} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {d.items.map((i) => (
                    <li key={i.id}>
                      <Badge
                        tone={
                          i.kind === 'strategy_change'
                            ? 'info'
                            : i.kind === 'decision'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {kindText[i.kind] ?? i.kind}
                      </Badge>{' '}
                      <span className={s.small}>{dt(i.at)}</span>
                      <p style={{ margin: '4px 0' }}>
                        <strong>{i.title}</strong>
                      </p>
                      <p className={s.small} style={{ whiteSpace: 'pre-line', margin: 0 }}>
                        {i.body}
                      </p>
                      {i.outcome && (
                        <p className={s.small}>
                          <strong>Результат:</strong> {i.outcome}
                        </p>
                      )}
                      {i.evidence && (
                        <details className={s.small}>
                          <summary>Данные</summary>
                          <pre style={{ whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(i.evidence, null, 2)}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="База знаний"
              note="Средние показатели по группам за 28 дней (n — число статей/постов)"
            >
              {d.insights.length === 0 ? (
                <p className={s.muted}>Нет данных.</p>
              ) : (
                <DataTable<Row>
                  caption="База знаний"
                  rows={d.insights as unknown as Row[]}
                  rowKey={(r) => `${String(r.dimension)}${String(r.value)}`}
                  columns={[
                    { key: 'dimension', label: 'Группа' },
                    { key: 'value', label: 'Значение' },
                    { key: 'sampleSize', label: 'n', numeric: true },
                    {
                      key: 'metrics',
                      label: 'Показатели',
                      render: (r) => (
                        <span className={s.small}>
                          {Object.entries(r.metrics as Record<string, number | null>)
                            .map(([k, v]) => `${k}: ${v ?? '—'}`)
                            .join(' · ')}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </div>
        )}
      </QueryView>
    </Page>
  );
}

// ── Интеграции ──────────────────────────────────────────────────────────

interface Integration {
  kind: SeoIntegrationKind;
  status: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  lastCheckAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

const HELP: Record<
  SeoIntegrationKind,
  { secret?: string; fields: [string, string][]; howto: string }
> = {
  anthropic: {
    fields: [],
    howto:
      'Ключ задаётся только в окружении worker: ANTHROPIC_API_KEY в infra/.env на сервере (console.anthropic.com → API keys). В админку и базу ключ не попадает.',
  },
  yandex_webmaster: {
    secret: 'OAuth-токен Яндекса',
    fields: [],
    howto:
      'Создайте приложение на oauth.yandex.ru с правами «Яндекс.Вебмастер: получение информации о сайтах» (webmaster:hostinfo), получите токен владельца сайта zybrilka.ru (сайт должен быть подтверждён в Вебмастере).',
  },
  yandex_metrika: {
    secret: 'OAuth-токен Яндекса',
    fields: [
      ['counterId', 'Номер счётчика'],
      ['registrationGoalId', 'ID цели «Регистрация» (необязательно)'],
    ],
    howto:
      'Права приложения: «Яндекс.Метрика: получение статистики» (metrika:read). Счётчик сайта — 114059780.',
  },
  google_search_console: {
    secret: 'JSON ключа сервисного аккаунта',
    fields: [['siteUrl', 'Ресурс GSC (sc-domain:zybrilka.ru или https://zybrilka.ru/)']],
    howto:
      'В Google Cloud создайте сервисный аккаунт, включите Search Console API, скачайте JSON-ключ и добавьте email аккаунта пользователем ресурса в Search Console (права «Ограниченные» достаточно).',
  },
  indexnow: {
    fields: [],
    howto:
      'Ключ генерируется автоматически и публикуется по адресу /blog/indexnow-<ключ>.txt. Нажмите «Сохранить» — новые статьи будут сразу отправляться в Яндекс через IndexNow.',
  },
  telegram_channel: {
    fields: [['channelId', 'Канал (@username или -100…)']],
    howto:
      'Добавьте бота Зубрилки (TELEGRAM_BOT_TOKEN) администратором канала с правом публикации.',
  },
  vk: {
    secret: 'Токен сообщества (права wall)',
    fields: [['groupId', 'ID сообщества (число)']],
    howto: 'Управление сообществом → Работа с API → создать ключ с доступом к стене.',
  },
};

function IntegrationCard({
  item,
  keyReady,
  reload,
}: {
  item: Integration;
  keyReady: boolean;
  reload: () => void;
}) {
  const help = HELP[item.kind];
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(
      help.fields.map(([k]) => [k, item.config[k] === undefined ? '' : String(item.config[k])]),
    ),
  );
  const [secret, setSecret] = useState('');
  const { msg, act } = useAction(reload);
  const tone =
    item.status === 'connected'
      ? 'good'
      : item.status === 'error'
        ? 'bad'
        : item.status === 'configured'
          ? 'info'
          : 'neutral';
  return (
    <Card
      title={SEO_INTEGRATION_LABELS[item.kind]}
      actions={<Badge tone={tone}>{integrationStatusText[item.status] ?? item.status}</Badge>}
      note={
        item.lastSyncAt
          ? `Синхронизация: ${dt(item.lastSyncAt)}`
          : item.lastCheckAt
            ? `Проверка: ${dt(item.lastCheckAt)}`
            : undefined
      }
    >
      <p className={s.small}>{help.howto}</p>
      {item.kind === 'indexnow' && typeof item.config.key === 'string' && (
        <p className={s.small}>
          Ключ: <span className={s.mono}>{item.config.key}</span>
        </p>
      )}
      {item.lastError && <p className={s.down}>{item.lastError}</p>}
      {item.kind !== 'anthropic' && (
        <div className={s.grid}>
          {help.fields.map(([k, label]) => (
            <label key={k} className={s.field}>
              {label}
              <input
                className={s.input}
                value={config[k] ?? ''}
                onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
              />
            </label>
          ))}
          {help.secret && (
            <label className={s.field}>
              {help.secret}{' '}
              {item.hasSecret && (
                <span className={s.small}>(сохранён; введите новый, чтобы заменить)</span>
              )}
              {item.kind === 'google_search_console' ? (
                <textarea
                  className={s.textarea}
                  rows={3}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                />
              ) : (
                <input
                  className={s.input}
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              )}
              {!keyReady && (
                <span className={s.down}>
                  На сервере не задан SEO_SECRETS_KEY — секреты сохранить нельзя.
                </span>
              )}
            </label>
          )}
          <div className={s.toolbar}>
            <button
              type="button"
              className={`${s.button} ${s.buttonPrimary}`}
              onClick={() =>
                void act(async () => {
                  const cfg = Object.fromEntries(
                    Object.entries(config).filter(([, v]) => v.trim() !== ''),
                  );
                  await adminApi.put(`/seo/integrations/${item.kind}`, {
                    config: cfg,
                    ...(secret ? { secret } : {}),
                  });
                  setSecret('');
                }, 'Сохранено. Worker проверит подключение в течение минуты.')
              }
            >
              Сохранить
            </button>
            {item.status !== 'not_configured' && (
              <button
                type="button"
                className={s.button}
                onClick={() =>
                  void act(
                    () => adminApi.post(`/seo/integrations/${item.kind}/check`, {}),
                    'Проверка поставлена в очередь.',
                  )
                }
              >
                Проверить
              </button>
            )}
            {item.status !== 'not_configured' && (
              <button
                type="button"
                className={`${s.button} ${s.buttonDanger}`}
                onClick={() => void act(() => adminApi.delete(`/seo/integrations/${item.kind}`))}
              >
                Отключить
              </button>
            )}
          </div>
          {msg && <p className={s.small}>{msg}</p>}
        </div>
      )}
    </Card>
  );
}

export function SeoIntegrationsPage() {
  const query = useAdminQuery<{ secretsKeyConfigured: boolean; items: Integration[] }>(
    '/seo/integrations',
  );
  return (
    <Page
      title="Интеграции"
      subtitle="Только официальные API. Токены хранятся зашифрованными (AES-256-GCM) и никогда не возвращаются в браузер."
    >
      <QueryView query={query} skeleton={400}>
        {(d) => (
          <>
            {!d.secretsKeyConfigured && (
              <Note>
                На сервере не задан SEO_SECRETS_KEY. Сгенерируйте его командой «openssl rand -base64
                32», пропишите в infra/.env для api и worker и перезапустите их.
              </Note>
            )}
            <div className={s.cols2}>
              {d.items.map((i) => (
                <IntegrationCard
                  key={`${i.kind}${i.status}${i.lastCheckAt}`}
                  item={i}
                  keyReady={d.secretsKeyConfigured}
                  reload={query.reload}
                />
              ))}
            </div>
          </>
        )}
      </QueryView>
    </Page>
  );
}
