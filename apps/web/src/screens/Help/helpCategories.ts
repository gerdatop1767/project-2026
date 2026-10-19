import type { IconName } from '../../ui/Icon/icons.js';

export interface HelpCategory {
  id: 'suggestions' | 'technical' | 'login' | 'other';
  icon: IconName;
  color: string;
  title: string;
  description: string;
}

/**
 * The four Помощь categories. There is one support channel (the Telegram
 * bot), so every card opens the same link — they help the visitor see
 * that their kind of question is welcome, they are not separate flows.
 */
export const helpCategories: readonly HelpCategory[] = [
  {
    id: 'suggestions',
    icon: 'hint',
    color: 'var(--color-warning)',
    title: 'Предложения',
    description: 'Идеи по улучшению сайта',
  },
  {
    id: 'technical',
    icon: 'settings',
    color: 'var(--chart-1)',
    title: 'Технические проблемы',
    description: 'Сайт не работает или что-то не загружается',
  },
  {
    id: 'login',
    icon: 'profile',
    color: 'var(--chart-6)',
    title: 'Проблемы с входом',
    description: 'Не удаётся войти или восстановить доступ',
  },
  {
    id: 'other',
    icon: 'chat',
    color: 'var(--chart-2)',
    title: 'Другие запросы',
    description: 'Любые другие вопросы и обращения',
  },
];
