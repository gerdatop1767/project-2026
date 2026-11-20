import {
  SEO_ARTICLE_FORMAT_LABELS,
  SEO_ARTICLE_STATUS_LABELS,
  SEO_ARTICLE_STATUSES,
  type SeoArticleFormat,
} from '@zybrilka/shared';
import { useState } from 'react';
import { adminApi, errorText } from '../../adminApi.js';
import { PageHead } from '../../components/Shell.js';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Note,
  Pager,
  QueryView,
} from '../../components/ui.js';
import { num, pct } from '../../format.js';
import { AdminLink, useAdminRouter } from '../../router.js';
import { useAdminQuery } from '../../useAdminQuery.js';
import { ArticleStatus, NoData, SeoTabs, taskKindText } from './common.js';
import s from '../../admin.module.css';

interface Metrics {
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  position: number | null;
  organicVisits: number | null;
  views: number | null;
  registrations: number;
  ctaClicks: number;
  seoScore: number | null;
}
interface ListItem {
  id: string;
  title: string;
  slug: string;
  url: string;
  status: string;
  primaryKeyword: string | null;
  secondaryKeywords: string[];
  priority: number | null;
  createdAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  wordCount: number;
  metrics: Metrics | null;
}
const d = (v: string | null) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—');
const val = (v: number | null | undefined, f: (n: number) => string = num) =>
  v === null || v === undefined ? <NoData>—</NoData> : f(v);

export function SeoArticlesPage() {
  const { location, setParams } = useAdminRouter();
  const status = location.params.get('status') ?? '';
  const sort = location.params.get('sort') ?? 'created';
  const page = Number(location.params.get('page') ?? '1');
  const [q, setQ] = useState(location.params.get('q') ?? '');
  const query = useAdminQuery<{
    items: ListItem[];
    total: number;
    page: number;
    pageSize: number;
    counts: Record<string, number>;
  }>('/seo/articles', {
    status: status || undefined,
    sort,
    page,
    q: location.params.get('q') || undefined,
  });
  const [newTitle, setNewTitle] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const create = async (generate: boolean) => {
    setMsg(null);
    try {
      await adminApi.post('/seo/articles', { title: newTitle, generate });
      setNewTitle('');
      setMsg(
        generate ? 'Статья создана, агент начнёт писать её в течение минуты.' : 'Идея сохранена.',
      );
      query.reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <>
      <PageHead
        title="Статьи"
        subtitle={
          <p className={s.subtitle}>
            Все статьи блога zybrilka.ru/blog с реальной статистикой за 28 дней
          </p>
        }
      />
      <SeoTabs />
      <Card title="Новая статья">
        <div className={s.toolbar}>
          <input
            className={s.input}
            style={{ flex: '1 1 260px' }}
            placeholder="Тема или заголовок, например «Как решать задание 13 ЕГЭ»"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button
            type="button"
            className={s.button}
            disabled={newTitle.trim().length < 5}
            onClick={() => create(false)}
          >
            Сохранить идею
          </button>
          <button
            type="button"
            className={`${s.button} ${s.buttonPrimary}`}
            disabled={newTitle.trim().length < 5}
            onClick={() => create(true)}
          >
            Написать с агентом
          </button>
        </div>
        {msg && <p className={s.small}>{msg}</p>}
      </Card>
      <div className={s.filters}>
        <select
          className={s.select}
          aria-label="Статус"
          value={status}
          onChange={(e) => setParams({ status: e.target.value, page: null })}
        >
          <option value="">Все статусы</option>
          {SEO_ARTICLE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {SEO_ARTICLE_STATUS_LABELS[st]}
              {query.data?.counts[st] ? ` (${query.data.counts[st]})` : ''}
            </option>
          ))}
        </select>
        <select
          className={s.select}
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setParams({ sort: e.target.value, page: null })}
        >
          <option value="created">Новые</option>
          <option value="published">По дате публикации</option>
          <option value="priority">По SEO-приоритету</option>
          <option value="score">По эффективности (SEO Score)</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q, page: null });
          }}
        >
          <input
            className={`${s.input} ${s.search}`}
            type="search"
            placeholder="Поиск по названию"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
      </div>
      <QueryView
        query={query}
        skeleton={360}
        isEmpty={(x) => x.items.length === 0}
        empty="Статей пока нет. Включите агента или создайте статью вручную."
      >
        {(data) => (
          <>
            <DataTable<ListItem & Record<string, unknown>>
              caption="Статьи"
              rows={data.items as (ListItem & Record<string, unknown>)[]}
              rowKey={(a) => a.id}
              columns={[
                {
                  key: 'title',
                  label: 'Название',
                  render: (a) => (
                    <>
                      <AdminLink to={`/admin/seo/articles/${a.id}`} className={s.link}>
                        {a.title}
                      </AdminLink>
                      <br />
                      <span className={`${s.small} ${s.mono}`}>/blog/{a.slug}</span>
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Статус',
                  render: (a) => <ArticleStatus status={a.status} />,
                },
                {
                  key: 'kw',
                  label: 'Ключевые запросы',
                  render: (a) => (
                    <span className={s.small}>
                      {[a.primaryKeyword, ...a.secondaryKeywords.slice(0, 2)]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </span>
                  ),
                },
                {
                  key: 'priority',
                  label: 'Приоритет',
                  numeric: true,
                  render: (a) => val(a.priority, (v) => v.toFixed(0)),
                },
                { key: 'createdAt', label: 'Создана', render: (a) => d(a.createdAt) },
                {
                  key: 'publishedAt',
                  label: 'Опубликована',
                  render: (a) =>
                    a.publishedAt
                      ? d(a.publishedAt)
                      : a.scheduledFor
                        ? `план: ${d(a.scheduledFor)}`
                        : '—',
                },
                {
                  key: 'views',
                  label: 'Просмотры',
                  numeric: true,
                  render: (a) => val(a.metrics?.views),
                },
                {
                  key: 'organic',
                  label: 'Из поиска',
                  numeric: true,
                  render: (a) => val(a.metrics?.organicVisits ?? a.metrics?.clicks),
                },
                {
                  key: 'position',
                  label: 'Позиция',
                  numeric: true,
                  render: (a) => val(a.metrics?.position, (v) => v.toFixed(1)),
                },
                {
                  key: 'regs',
                  label: 'Регистрации',
                  numeric: true,
                  render: (a) => num(a.metrics?.registrations ?? 0),
                },
                {
                  key: 'score',
                  label: 'SEO Score',
                  numeric: true,
                  render: (a) => val(a.metrics?.seoScore, (v) => v.toFixed(0)),
                },
              ]}
            />
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(p: number) => setParams({ page: String(p) })}
            />
          </>
        )}
      </QueryView>
    </>
  );
}

interface Detail {
  article: {
    id: string;
    status: string;
    slug: string;
    title: string;
    seoTitle: string | null;
    metaDescription: string | null;
    h1: string | null;
    format: string | null;
    subjectId: string | null;
    bodyMd: string;
    faq: { question: string; answer: string }[];
    sources: { title: string; url: string }[];
    ogTitle: string | null;
    ogDescription: string | null;
    primaryKeyword: string | null;
    secondaryKeywords: string[];
    ctaPath: string;
    priority: number | null;
    factCheckPassed: boolean | null;
    reviewNotes: {
      verdict?: string;
      summary?: string;
      factualIssues?: { claim: string; problem: string; correction: string }[];
      pendingRevisionId?: string;
    } | null;
    lastCheck: Record<string, unknown> | null;
    publishedAt: string | null;
    scheduledFor: string | null;
    version: number;
  };
  url: string;
  previewHtml: string;
  qualityIssues: string[];
  revisions: { id: string; version: number; reason: string; actor: string; createdAt: string }[];
  media: {
    id: string;
    fileName: string;
    alt: string;
    kind: string;
    width: number;
    height: number;
    sizeBytes: number;
    origin: string;
    license: string;
  }[];
  posts: {
    id: string;
    platform: string;
    status: string;
    title: string | null;
    body: string;
    link: string;
    externalUrl: string | null;
    checklist: string[];
    mode: string;
  }[];
  log: { id: string; at: string; message: string; level: string }[];
  metrics: Metrics | null;
}

interface Form {
  title: string;
  seoTitle: string;
  metaDescription: string;
  h1: string;
  bodyMd: string;
  ogTitle: string;
  ogDescription: string;
  primaryKeyword: string;
  ctaPath: string;
  slug: string;
  faqText: string;
  secondary: string;
}

const toForm = (a: Detail['article']): Form => ({
  title: a.title,
  seoTitle: a.seoTitle ?? '',
  metaDescription: a.metaDescription ?? '',
  h1: a.h1 ?? '',
  bodyMd: a.bodyMd,
  ogTitle: a.ogTitle ?? '',
  ogDescription: a.ogDescription ?? '',
  primaryKeyword: a.primaryKeyword ?? '',
  ctaPath: a.ctaPath,
  slug: a.slug,
  faqText: a.faq.map((f) => `${f.question}\n${f.answer}`).join('\n\n'),
  secondary: a.secondaryKeywords.join(', '),
});

export function SeoArticlePage({ id = '' }: Record<string, string>) {
  const query = useAdminQuery<Detail>(`/seo/articles/${id}`);
  const [draft, setForm] = useState<Form | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('preview');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish' | { apply: string }>(null);
  const [instructions, setInstructions] = useState('');

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      query.reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  const save = (form: Form) =>
    call(() => {
      const faq = form.faqText
        .split(/\n\s*\n/)
        .map((b) => b.trim().split('\n'))
        .filter((l) => l.length >= 2)
        .map(([question, ...rest]) => ({
          question: question!.trim(),
          answer: rest.join(' ').trim(),
        }));
      return adminApi.patch(`/seo/articles/${id}`, {
        // The version this editor was opened on: the server refuses (409) if it changed.
        version: query.data?.article.version,
        title: form.title,
        seoTitle: form.seoTitle,
        metaDescription: form.metaDescription,
        h1: form.h1,
        bodyMd: form.bodyMd,
        ogTitle: form.ogTitle,
        ogDescription: form.ogDescription,
        primaryKeyword: form.primaryKeyword,
        secondaryKeywords: form.secondary
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x.length >= 2),
        ctaPath: form.ctaPath,
        faq,
        ...(query.data?.article.publishedAt ? {} : { slug: form.slug }),
      });
    }, 'Сохранено (предыдущая версия — в ревизиях).').then(() => setForm(null));
  const generate = (mode: 'write' | 'update' | 'visuals' | 'review' | 'distribute') =>
    call(
      () =>
        adminApi.post(`/seo/articles/${id}/generate`, {
          mode,
          instructions: instructions || undefined,
        }),
      `Задача «${taskKindText[{ write: 'write_article', update: 'update_article', visuals: 'visuals', review: 'review_article', distribute: 'distribute' }[mode]]}» поставлена в очередь.`,
    );

  return (
    <QueryView query={query} skeleton={500}>
      {(d) => {
        const a = d.article;
        // Unsaved edits, or the stored article.
        const form = draft ?? toForm(a);
        const live = a.status === 'published' || a.status === 'needs_update';
        const pending = a.reviewNotes?.pendingRevisionId;
        const field = (k: keyof Form, label: string, multiline = false, hint?: string) =>
          form && (
            <label className={s.field}>
              {label}
              {multiline ? (
                <textarea
                  className={s.textarea}
                  rows={k === 'bodyMd' ? 24 : 3}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              ) : (
                <input
                  className={s.input}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  disabled={k === 'slug' && Boolean(a.publishedAt)}
                />
              )}
              {hint && <span className={s.small}>{hint}</span>}
            </label>
          );
        return (
          <>
            <AdminLink to="/admin/seo/articles" className={s.backLink}>
              ← Все статьи
            </AdminLink>
            <PageHead
              title={a.title}
              subtitle={
                <p className={s.subtitle}>
                  <ArticleStatus status={a.status} />{' '}
                  {live ? (
                    <a className={s.link} href={d.url} target="_blank" rel="noreferrer">
                      {d.url}
                    </a>
                  ) : (
                    <span className={s.mono}>/blog/{a.slug}</span>
                  )}{' '}
                  · версия {a.version}
                  {a.format
                    ? ` · ${SEO_ARTICLE_FORMAT_LABELS[a.format as SeoArticleFormat] ?? a.format}`
                    : ''}
                </p>
              }
              actions={
                <>
                  {!live && (
                    <button
                      type="button"
                      className={`${s.button} ${s.buttonPrimary}`}
                      onClick={() => setConfirm('publish')}
                    >
                      Опубликовать
                    </button>
                  )}
                  {live && (
                    <button
                      type="button"
                      className={`${s.button} ${s.buttonDanger}`}
                      onClick={() => setConfirm('unpublish')}
                    >
                      Снять с публикации
                    </button>
                  )}
                </>
              }
            />
            <SeoTabs />
            {msg && <Note>{msg}</Note>}
            {pending && (
              <Note>
                Агент подготовил обновление этой статьи.{' '}
                {a.reviewNotes?.verdict === 'pass'
                  ? 'Факт-чек пройден.'
                  : `Факт-чек: ${a.reviewNotes?.verdict ?? '—'}.`}{' '}
                На сайте пока старая версия.{' '}
                <button
                  type="button"
                  className={s.button}
                  onClick={() => setConfirm({ apply: pending })}
                >
                  Применить обновление
                </button>
              </Note>
            )}
            {(d.qualityIssues.length > 0 || a.factCheckPassed === false) && (
              <Card title="Требует внимания">
                <ul className={s.small}>
                  {d.qualityIssues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                  {a.reviewNotes?.factualIssues?.map((i) => (
                    <li key={i.claim}>
                      <strong>Факт:</strong> {i.claim} — {i.problem}. <em>Исправление:</em>{' '}
                      {i.correction}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <div className={s.kpis}>
              {(
                [
                  ['Показы', d.metrics?.impressions],
                  ['Клики из поиска', d.metrics?.clicks],
                  ['Визиты из поиска', d.metrics?.organicVisits],
                  ['Переходы в тренажёр', d.metrics?.ctaClicks],
                  ['Регистрации', d.metrics?.registrations],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className={s.kpi}>
                  <span className={s.kpiLabel}>{l}</span>
                  <span className={s.kpiValue}>
                    {v === null || v === undefined ? <NoData /> : num(v)}
                  </span>
                </div>
              ))}
              <div className={s.kpi}>
                <span className={s.kpiLabel}>CTR / позиция</span>
                <span className={s.kpiValue}>
                  {d.metrics?.ctr !== null && d.metrics?.ctr !== undefined
                    ? pct(d.metrics.ctr, 1)
                    : '—'}{' '}
                  / {d.metrics?.position?.toFixed(1) ?? '—'}
                </span>
              </div>
              <div className={s.kpi}>
                <span className={s.kpiLabel}>SEO Score</span>
                <span className={s.kpiValue}>{d.metrics?.seoScore?.toFixed(0) ?? <NoData />}</span>
              </div>
            </div>
            <Card
              title="Содержание"
              actions={
                <div className={s.segmented}>
                  {(['preview', 'edit'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${s.segment} ${tab === t ? s.segmentActive : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t === 'preview' ? 'Предпросмотр' : 'Редактировать'}
                    </button>
                  ))}
                </div>
              }
            >
              {tab === 'preview' ? (
                <div className={s.preview}>
                  <p className={s.small}>
                    <strong>Title:</strong> {a.seoTitle ?? '—'} ({(a.seoTitle ?? '').length})<br />
                    <strong>Description:</strong> {a.metaDescription ?? '—'} (
                    {(a.metaDescription ?? '').length})
                  </p>
                  <h1>{a.h1 ?? a.title}</h1>
                  {/* Server-rendered by the same safe renderer the blog uses (everything escaped). */}
                  <div dangerouslySetInnerHTML={{ __html: d.previewHtml }} />
                  {a.faq.length > 0 && (
                    <>
                      <h2>Частые вопросы</h2>
                      {a.faq.map((f) => (
                        <details key={f.question}>
                          <summary>{f.question}</summary>
                          <p>{f.answer}</p>
                        </details>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                form && (
                  <div className={s.grid}>
                    <div className={s.cols2}>
                      {field('title', 'Название')}
                      {field('h1', 'H1')}
                      {field(
                        'seoTitle',
                        'SEO Title',
                        false,
                        `${form.seoTitle.length} симв., до 65`,
                      )}
                      {field(
                        'slug',
                        'URL (slug)',
                        false,
                        a.publishedAt ? 'URL опубликованной статьи не меняется' : undefined,
                      )}
                      {field('primaryKeyword', 'Основной запрос')}
                      {field('secondary', 'Доп. запросы (через запятую)')}
                      {field('ogTitle', 'Open Graph Title')}
                      {field('ctaPath', 'Куда ведёт кнопка (путь в тренажёре)')}
                    </div>
                    {field(
                      'metaDescription',
                      'Meta Description',
                      true,
                      `${form.metaDescription.length} симв., 120–160`,
                    )}
                    {field('ogDescription', 'Open Graph Description', true)}
                    {field(
                      'bodyMd',
                      'Текст (Markdown: ## заголовки, списки, | таблицы |, > [!tip], ![alt](media:id))',
                      true,
                    )}
                    {field(
                      'faqText',
                      'FAQ: вопрос на первой строке, ответ ниже, блоки через пустую строку',
                      true,
                    )}
                    <div className={s.toolbar}>
                      <button
                        type="button"
                        className={`${s.button} ${s.buttonPrimary}`}
                        onClick={() => void save(form)}
                      >
                        Сохранить
                      </button>
                    </div>
                  </div>
                )
              )}
            </Card>
            <Card title="Агент">
              <div className={s.grid}>
                <label className={s.field}>
                  Указания агенту (необязательно)
                  <textarea
                    className={s.textarea}
                    rows={2}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Например: добавь разбор двух примеров с отбором корней"
                  />
                </label>
                <div className={s.toolbar}>
                  <button
                    type="button"
                    className={s.button}
                    onClick={() => generate(live ? 'update' : 'write')}
                  >
                    {live ? 'Подготовить обновление' : a.bodyMd ? 'Переписать' : 'Написать'}
                  </button>
                  <button type="button" className={s.button} onClick={() => generate('review')}>
                    Факт-чек
                  </button>
                  <button type="button" className={s.button} onClick={() => generate('visuals')}>
                    Изображения
                  </button>
                  {live && (
                    <button
                      type="button"
                      className={s.button}
                      onClick={() => generate('distribute')}
                    >
                      Внешние публикации
                    </button>
                  )}
                </div>
              </div>
            </Card>
            <div className={s.cols2}>
              <Card title="Изображения">
                {d.media.length === 0 ? (
                  <p className={s.muted}>Нет изображений.</p>
                ) : (
                  <ul className={s.grid} style={{ listStyle: 'none', padding: 0 }}>
                    {d.media.map((m) => (
                      <li key={m.id} className={s.small}>
                        <img
                          src={`/blog/media/${m.fileName}`}
                          alt={m.alt}
                          width={160}
                          style={{ height: 'auto', borderRadius: 8, display: 'block' }}
                          loading="lazy"
                        />
                        {m.kind} · {m.width}×{m.height} · {(m.sizeBytes / 1024).toFixed(1)} КБ ·
                        alt: «{m.alt}» · {m.license}
                        <br />
                        <code className={s.mono}>
                          ![{m.alt}](media:{m.id})
                        </code>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Ревизии">
                {d.revisions.length === 0 ? (
                  <p className={s.muted}>Изменений ещё не было.</p>
                ) : (
                  <ul className={s.small}>
                    {d.revisions.map((r) => (
                      <li key={r.id}>
                        v{r.version} · {r.reason} · {r.actor} ·{' '}
                        {new Date(r.createdAt).toLocaleString('ru-RU')}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            {d.posts.length > 0 && (
              <Card title="Внешние публикации этой статьи">
                <ul className={s.small}>
                  {d.posts.map((p) => (
                    <li key={p.id}>
                      {p.platform}:{' '}
                      <Badge
                        tone={
                          p.status === 'published'
                            ? 'good'
                            : p.status === 'error'
                              ? 'bad'
                              : 'neutral'
                        }
                      >
                        {p.status}
                      </Badge>{' '}
                      {p.externalUrl && (
                        <a className={s.link} href={p.externalUrl} target="_blank" rel="noreferrer">
                          {p.externalUrl}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
                <AdminLink to="/admin/seo/external" className={s.link}>
                  Все внешние публикации →
                </AdminLink>
              </Card>
            )}
            <Card title="История действий агента">
              <ul className={s.small}>
                {d.log.map((l) => (
                  <li key={l.id} className={l.level === 'error' ? s.down : undefined}>
                    {new Date(l.at).toLocaleString('ru-RU')} — {l.message}
                  </li>
                ))}
              </ul>
              {a.lastCheck && (
                <p className={s.small}>
                  Последняя проверка страницы: {JSON.stringify(a.lastCheck)}
                </p>
              )}
            </Card>
            <ConfirmDialog
              open={confirm !== null}
              danger={confirm === 'unpublish'}
              title={
                confirm === 'publish'
                  ? 'Опубликовать статью?'
                  : confirm === 'unpublish'
                    ? 'Снять статью с публикации?'
                    : 'Применить обновление?'
              }
              confirmLabel={
                confirm === 'publish'
                  ? 'Опубликовать'
                  : confirm === 'unpublish'
                    ? 'Снять'
                    : 'Применить'
              }
              onClose={() => setConfirm(null)}
              onConfirm={async () => {
                if (confirm === 'publish')
                  await adminApi.post(`/seo/articles/${id}/publish`, { confirm: true });
                else if (confirm === 'unpublish')
                  await adminApi.post(`/seo/articles/${id}/unpublish`, { confirm: true });
                else if (confirm)
                  await adminApi.post(`/seo/articles/${id}/revisions/${confirm.apply}/apply`, {
                    confirm: true,
                  });
                query.reload();
              }}
            >
              {confirm === 'publish'
                ? `Статья появится на ${d.url}, в sitemap блога и будет отправлена в IndexNow.${d.qualityIssues.length ? ' Внимание: есть замечания качества.' : ''}${a.factCheckPassed ? '' : ' Факт-чек не пройден или не выполнялся.'}`
                : confirm === 'unpublish'
                  ? 'Страница начнёт отвечать 404 и выпадет из sitemap.'
                  : 'Текст на сайте заменится новой версией; старая сохранится в ревизиях.'}
            </ConfirmDialog>
          </>
        );
      }}
    </QueryView>
  );
}
