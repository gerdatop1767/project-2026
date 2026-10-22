import { useState, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { AdminLink, useAdminRouter } from '../router.js';
import s from '../admin.module.css';

export const sections = [
  { path: '/admin', label: 'Обзор', icon: '◎' },
  { path: '/admin/growth', label: 'Аналитика и рост', icon: '↗' },
  { path: '/admin/content', label: 'Задания и предметы', icon: '▤' },
  { path: '/admin/users', label: 'Пользователи', icon: '☺' },
  { path: '/admin/funnels', label: 'Воронки и удержание', icon: '⏷' },
  { path: '/admin/campaigns', label: 'Кампании и ссылки', icon: '🔗' },
  { path: '/admin/complaints', label: 'Жалобы на задания', icon: '⚑' },
  { path: '/admin/quality', label: 'Качество обучения', icon: '✓' },
  { path: '/admin/health', label: 'Техническое состояние', icon: '♥' },
  { path: '/admin/manage', label: 'Управление', icon: '⚙' },
] as const;

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
        {sections.map((sec) => (
          <AdminLink
            key={sec.path}
            to={sec.path}
            className={clsx(s.navLink, isActive(sec.path, location.path) && s.navLinkActive)}
            aria-current={isActive(sec.path, location.path) ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">{sec.icon}</span>
            {sec.label}
            {sec.path === '/admin/complaints' && newComplaints ? (
              <span className={s.navBadge} aria-label={`новых: ${newComplaints}`}>
                {newComplaints}
              </span>
            ) : null}
          </AdminLink>
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
