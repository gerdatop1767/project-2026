import type { BottomNavItem } from './BottomNav.js';

/**
 * The 5-item nav: Главная / Задания / Статистика / Мои ошибки /
 * Профиль. "Достижения" is no longer a tab slot — it moved inside
 * Статистика (a real section there, still the same screen/data, see
 * StatisticsMobile) alongside "Рейтинг"; "Мои ошибки" took its slot
 * back since it's a real, high-value training mode that deserves a
 * one-tap entry point, not just a link from inside Статистика.
 */
export const defaultBottomNavItems: readonly BottomNavItem[] = [
  { id: 'home', label: 'Главная', icon: 'home', href: '/' },
  { id: 'training', label: 'Задания', icon: 'training', href: '/training' },
  { id: 'statistics', label: 'Статистика', icon: 'progress', href: '/statistics' },
  { id: 'mistakes', label: 'Мои ошибки', icon: 'mistakes', href: '/training/mistakes' },
  { id: 'profile', label: 'Профиль', icon: 'profile', href: '/profile' },
];
