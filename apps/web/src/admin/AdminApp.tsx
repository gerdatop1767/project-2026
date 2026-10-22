import { lazy, Suspense, type ComponentType } from 'react';
import { AdminApiError } from './adminApi.js';
import { Shell } from './components/Shell.js';
import { ErrorState, Skeleton } from './components/ui.js';
import { AdminRouter, matchPath, useAdminRouter } from './router.js';
import { useAdminQuery } from './useAdminQuery.js';
import s from './admin.module.css';

/**
 * The owner-only admin panel (/admin). Its own lazy chunk, never loaded by
 * ordinary visitors' screens. This page decides NOTHING about access: it
 * asks the server (/admin/me), which answers 401/403 for anyone but the
 * configured owner — and every admin endpoint checks again on its own.
 */
const page = <K extends string>(
  load: () => Promise<Record<K, ComponentType<Record<string, string>>>>,
  name: K,
) => lazy(() => load().then((m) => ({ default: m[name] })));

const OverviewPage = page(() => import('./pages/Overview.js'), 'OverviewPage');
const GrowthPage = page(() => import('./pages/Growth.js'), 'GrowthPage');
const ContentPage = page(() => import('./pages/Content.js'), 'ContentPage');
const SubjectPage = page(() => import('./pages/Content.js'), 'SubjectPage');
const TaskPage = page(() => import('./pages/Content.js'), 'TaskPage');
const UsersPage = page(() => import('./pages/Users.js'), 'UsersPage');
const UserPage = page(() => import('./pages/Users.js'), 'UserPage');
const FunnelsPage = page(() => import('./pages/Funnels.js'), 'FunnelsPage');
const CampaignsPage = page(() => import('./pages/Campaigns.js'), 'CampaignsPage');
const CampaignPage = page(() => import('./pages/Campaigns.js'), 'CampaignPage');
const ComplaintsPage = page(() => import('./pages/Complaints.js'), 'ComplaintsPage');
const ComplaintPage = page(() => import('./pages/Complaints.js'), 'ComplaintPage');
const QualityPage = page(() => import('./pages/Quality.js'), 'QualityPage');
const HealthPage = page(() => import('./pages/Health.js'), 'HealthPage');
const ManagePage = page(() => import('./pages/Manage.js'), 'ManagePage');

const routes: [string, ComponentType<Record<string, string>>][] = [
  ['/admin', OverviewPage],
  ['/admin/growth', GrowthPage],
  ['/admin/content', ContentPage],
  ['/admin/content/subjects/:id', SubjectPage],
  ['/admin/content/tasks/:id', TaskPage],
  ['/admin/users', UsersPage],
  ['/admin/users/:id', UserPage],
  ['/admin/funnels', FunnelsPage],
  ['/admin/campaigns', CampaignsPage],
  ['/admin/campaigns/:id', CampaignPage],
  ['/admin/complaints', ComplaintsPage],
  ['/admin/complaints/:id', ComplaintPage],
  ['/admin/quality', QualityPage],
  ['/admin/health', HealthPage],
  ['/admin/manage', ManagePage],
];

function Routes() {
  const { location } = useAdminRouter();
  for (const [pattern, Page] of routes) {
    const params = matchPath(pattern, location.path);
    if (params) {
      return (
        <Suspense fallback={<Skeleton height={320} />}>
          <Page key={location.path} {...params} />
        </Suspense>
      );
    }
  }
  return (
    <div className={s.state}>
      <p>Такого раздела нет.</p>
    </div>
  );
}

function Gate() {
  const me = useAdminQuery<{ userId: string; role: 'owner' }>('/me');
  const complaints = useAdminQuery<{ counts: Record<string, number> }>(
    me.status === 'ready' ? '/complaints' : null,
    { pageSize: 5 },
  );
  if (me.status === 'loading' && !me.data) {
    return (
      <div className={s.state} role="status">
        Проверяем доступ…
      </div>
    );
  }
  if (me.status === 'error' || !me.data) {
    const status = me.error instanceof AdminApiError ? me.error.status : 0;
    if (status === 401) {
      return (
        <div className={s.state}>
          <h1 className={s.title}>Вход в админку</h1>
          <p>Войдите в аккаунт владельца, затем вернитесь на эту страницу.</p>
          <a className={`${s.button} ${s.buttonPrimary}`} href="/login">
            Войти
          </a>
        </div>
      );
    }
    if (status === 403) {
      return (
        <div className={s.state}>
          <h1 className={s.title}>Нет доступа</h1>
          <p>Этот раздел доступен только владельцу проекта.</p>
          <a className={s.button} href="/">
            В тренажёр
          </a>
        </div>
      );
    }
    return <ErrorState error={me.error} onRetry={me.reload} />;
  }
  return (
    <Shell newComplaints={complaints.data?.counts.new}>
      <Routes />
    </Shell>
  );
}

export function AdminApp() {
  return (
    <div className={s.root}>
      <AdminRouter>
        <Gate />
      </AdminRouter>
    </div>
  );
}
