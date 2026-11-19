import { SEO_ARTICLE_STATUS_LABELS, type SeoArticleStatus } from '@zybrilka/shared';
import type { ReactNode } from 'react';
import { clsx } from '../../../lib/clsx.js';
import { AdminLink, useAdminRouter } from '../../router.js';
import { Badge } from '../../components/ui.js';
import s from '../../admin.module.css';

/** AI SEO Center sub-sections (docs/SEO_CENTER.md §16). */
export const SEO_TABS = [
  { path: '/admin/seo', label: 'Overview' },
  { path: '/admin/seo/agent', label: 'AI Agent' },
  { path: '/admin/seo/articles', label: 'Статьи' },
  { path: '/admin/seo/external', label: 'Внешние площадки' },
  { path: '/admin/seo/keywords', label: 'Семантика' },
  { path: '/admin/seo/competitors', label: 'Конкуренты' },
  { path: '/admin/seo/audit', label: 'Технический SEO' },
  { path: '/admin/seo/learning', label: 'Журнал обучения' },
  { path: '/admin/seo/integrations', label: 'Интеграции' },
] as const;

export function SeoTabs() {
  const { location } = useAdminRouter();
  const active = (p: string) =>
    p === '/admin/seo'
      ? location.path === p
      : location.path === p || location.path.startsWith(`${p}/`);
  return (
    <nav
      className={s.segmented}
      aria-label="Разделы SEO Center"
      style={{ overflowX: 'auto', maxWidth: '100%', marginBottom: 16 }}
    >
      {SEO_TABS.map((t) => (
        <AdminLink
          key={t.path}
          to={t.path}
          className={clsx(s.segment, active(t.path) && s.segmentActive)}
          aria-current={active(t.path) ? 'page' : undefined}
          style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}
        >
          {t.label}
        </AdminLink>
      ))}
    </nav>
  );
}

const articleTone: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  idea: 'neutral',
  research: 'info',
  generating: 'info',
  draft: 'neutral',
  review: 'warn',
  scheduled: 'info',
  published: 'good',
  needs_update: 'warn',
  error: 'bad',
};

export function ArticleStatus({ status }: { status: string }) {
  return (
    <Badge tone={articleTone[status] ?? 'neutral'}>
      {SEO_ARTICLE_STATUS_LABELS[status as SeoArticleStatus] ?? status}
    </Badge>
  );
}

const taskTone: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  queued: 'neutral',
  running: 'info',
  done: 'good',
  failed: 'bad',
  cancelled: 'neutral',
  blocked: 'warn',
};
const taskText: Record<string, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  done: 'готово',
  failed: 'ошибка',
  cancelled: 'отменена',
  blocked: 'остановлена',
};
export function TaskStatus({ status }: { status: string }) {
  return <Badge tone={taskTone[status] ?? 'neutral'}>{taskText[status] ?? status}</Badge>;
}

export const integrationStatusText: Record<string, string> = {
  not_configured: 'Не подключено',
  configured: 'Сохранено, проверяется',
  connected: 'Подключено',
  error: 'Ошибка',
};

export const usd = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;

export function NoData({ children = 'Нет данных' }: { children?: ReactNode }) {
  return <span className={s.muted}>{children}</span>;
}

export const taskKindText: Record<string, string> = {
  cycle_daily: 'Дневной цикл',
  cycle_weekly: 'Недельный цикл',
  sync_metrics: 'Синхронизация метрик',
  research: 'Исследование тем',
  score_topics: 'Оценка тем',
  competitors: 'Анализ конкурентов',
  write_article: 'Написание статьи',
  update_article: 'Обновление статьи',
  review_article: 'Факт-чек',
  visuals: 'Изображения',
  post_publish_check: 'Проверка после публикации',
  distribute: 'Внешние публикации',
  publish_external: 'Публикация на площадке',
  technical_audit: 'Технический аудит',
  weekly_strategy: 'Недельная стратегия',
  refresh_articles: 'Поиск статей для обновления',
  check_integration: 'Проверка интеграции',
};

/** A stat tile for a non-numeric value (status, time). */
export function InfoTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.kpiValue}>{value}</span>
      {hint && <span className={s.kpiChange}>{hint}</span>}
    </div>
  );
}
