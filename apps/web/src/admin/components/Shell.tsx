import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { clsx } from '../../lib/clsx.js';
import { AdminLink, useAdminRouter } from '../router.js';
import s from '../admin.module.css';

export const sections = [
  { path: '/admin', label: 'Обзор', icon: 'home', group: 'Аналитика' },
  { path: '/admin/growth', label: 'Аналитика и рост', icon: 'trend', group: 'Аналитика' },
  { path: '/admin/funnels', label: 'Воронки и удержание', icon: 'filter', group: 'Аналитика' },
  { path: '/admin/streaks', label: 'Серии', icon: 'flame', group: 'Аналитика' },
  { path: '/admin/campaigns', label: 'Кампании и ссылки', icon: 'share', group: 'Аналитика' },
  { path: '/admin/users', label: 'Пользователи', icon: 'friends', group: 'Люди и контент' },
  { path: '/admin/content', label: 'Задания и предметы', icon: 'topic', group: 'Люди и контент' },
  {
    path: '/admin/complaints',
    label: 'Жалобы на задания',
    icon: 'warning',
    group: 'Люди и контент',
  },
  { path: '/admin/quality', label: 'Качество обучения', icon: 'success', group: 'Люди и контент' },
  { path: '/admin/support', label: 'Поддержка', icon: 'chat', group: 'Telegram' },
  { path: '/admin/broadcasts', label: 'Рассылки', icon: 'send', group: 'Telegram' },
  { path: '/admin/notifications', label: 'Уведомления', icon: 'notifications', group: 'Telegram' },
  { path: '/admin/health', label: 'Техническое состояние', icon: 'analysis', group: 'Система' },
  { path: '/admin/manage', label: 'Управление', icon: 'settings', group: 'Система' },
] as const satisfies readonly { path: string; label: string; icon: IconName; group: string }[];

function isActive(section: string, path: string) {
  if (section === '/admin') return path === '/admin' || path === '/admin/';
  return path === section || path.startsWith(`${section}/`);
}

export function Shell({
  children,
  newComplaints,
}: {
  children: ReactNode;
  newComplaints?: number;
}) {
  const { location } = useAdminRouter();
  const [open, setOpen] = useState(false);
  const current = sections.find((sec) => isActive(sec.path, location.path));
  return (
    <div className={s.layout}>
      {open && (
        <button
          type="button"
          className={s.scrim}
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        />
      )}
      <nav className={clsx(s.sidebar, open && s.sidebarOpen)} aria-label="Разделы админки">
        <div className={s.brand}>
          Зубрилка <span className={s.brandBadge}>админ</span>
        </div>
        {sections.map((sec, i) => (
          <Fragment key={sec.path}>
            {sections[i - 1]?.group !== sec.group && (
              <span className={s.navGroup}>{sec.group}</span>
            )}
            <AdminLink
              to={sec.path}
              className={clsx(s.navLink, isActive(sec.path, location.path) && s.navLinkActive)}
              aria-current={isActive(sec.path, location.path) ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon name={sec.icon} size={18} />
              {sec.label}
              {sec.path === '/admin/complaints' && newComplaints ? (
                <span className={s.navBadge} aria-label={`новых: ${newComplaints}`}>
                  {newComplaints}
                </span>
              ) : null}
            </AdminLink>
          </Fragment>
        ))}
        <div className={s.sidebarFoot}>
          <a className={s.link} href="/">
            ← В тренажёр
          </a>
          <p>Доступ только владельцу. Все действия записываются в журнал.</p>
        </div>
      </nav>
      <div className={s.main}>
        <div className={s.mobileBar}>
          <button
            type="button"
            className={s.button}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            ☰ Меню
          </button>
          <strong>{current?.label ?? 'Админка'}</strong>
        </div>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={s.pageHead}>
      <div>
        <h1 className={s.title}>{title}</h1>
        {subtitle}
      </div>
      {actions && <div className={s.toolbar}>{actions}</div>}
    </header>
  );
}
