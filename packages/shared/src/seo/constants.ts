/**
 * AI SEO Center (docs/SEO_CENTER.md) — vocabulary shared by the database
 * schema, the API, the worker and the admin panel. Plain string lists:
 * the DB stores them in `text` columns, so a list can grow without a
 * migration.
 */

export const SEO_MODES = ['manual', 'semi', 'auto'] as const;
export type SeoMode = (typeof SEO_MODES)[number];

/** Article lifecycle: Идея → Исследование → Генерация → Черновик → На проверке → Запланирована → Опубликована. */
export const SEO_ARTICLE_STATUSES = [
  'idea',
  'research',
  'generating',
  'draft',
  'review',
  'scheduled',
  'published',
  'needs_update',
  'error',
] as const;
export type SeoArticleStatus = (typeof SEO_ARTICLE_STATUSES)[number];

export const SEO_ARTICLE_STATUS_LABELS: Record<SeoArticleStatus, string> = {
  idea: 'Идея',
  research: 'Исследование',
  generating: 'Генерация',
  draft: 'Черновик',
  review: 'На проверке',
  scheduled: 'Запланирована',
  published: 'Опубликована',
  needs_update: 'Требует обновления',
  error: 'Ошибка',
};

export const SEO_ARTICLE_FORMATS = [
  'guide',
  'howto',
  'task_breakdown',
  'collection',
  'comparison',
  'faq',
  'news',
  'checklist',
  'mistakes',
  'materials',
] as const;
export type SeoArticleFormat = (typeof SEO_ARTICLE_FORMATS)[number];

export const SEO_ARTICLE_FORMAT_LABELS: Record<SeoArticleFormat, string> = {
  guide: 'Подробное руководство',
  howto: 'Инструкция',
  task_breakdown: 'Разбор заданий',
  collection: 'Подборка',
  comparison: 'Сравнение',
  faq: 'Ответы на вопросы',
  news: 'Новости ЕГЭ',
  checklist: 'Чек-лист',
  mistakes: 'Подборка ошибок',
  materials: 'Материалы для подготовки',
};

/** The nine logical agents (docs/SEO_CENTER.md §2). */
export const SEO_AGENTS = [
  'research',
  'competitor',
  'content',
  'visual',
  'distribution',
  'analytics',
  'optimization',
  'technical',
  'strategy',
  'system',
] as const;
export type SeoAgent = (typeof SEO_AGENTS)[number];

export const SEO_AGENT_LABELS: Record<SeoAgent, string> = {
  research: 'SEO Research',
  competitor: 'Competitor',
  content: 'Content',
  visual: 'Visual',
  distribution: 'Distribution',
  analytics: 'Analytics',
  optimization: 'Optimization',
  technical: 'Technical SEO',
  strategy: 'Strategy',
  system: 'Система',
};

/** Queue task kinds and the agent that owns each. */
export const SEO_TASK_KINDS = {
  cycle_daily: 'system',
  cycle_weekly: 'system',
  sync_metrics: 'analytics',
  research: 'research',
  score_topics: 'research',
  competitors: 'competitor',
  write_article: 'content',
  review_article: 'content',
  visuals: 'visual',
  post_publish_check: 'technical',
  distribute: 'distribution',
  publish_external: 'distribution',
  technical_audit: 'technical',
  weekly_strategy: 'strategy',
  refresh_articles: 'optimization',
  update_article: 'optimization',
  check_integration: 'analytics',
} as const satisfies Record<string, SeoAgent>;
export type SeoTaskKind = keyof typeof SEO_TASK_KINDS;
export const SEO_TASK_KIND_LIST = Object.keys(SEO_TASK_KINDS) as SeoTaskKind[];

export const SEO_TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'blocked',
] as const;
export type SeoTaskStatus = (typeof SEO_TASK_STATUSES)[number];

export const SEO_SEARCH_ENGINES = ['yandex', 'google'] as const;
export type SeoSearchEngine = (typeof SEO_SEARCH_ENGINES)[number];

export const SEO_INTEGRATIONS = [
  'anthropic',
  'yandex_webmaster',
  'yandex_metrika',
  'google_search_console',
  'indexnow',
  'telegram_channel',
  'vk',
] as const;
export type SeoIntegrationKind = (typeof SEO_INTEGRATIONS)[number];

export const SEO_INTEGRATION_LABELS: Record<SeoIntegrationKind, string> = {
  anthropic: 'Claude API (Anthropic)',
  yandex_webmaster: 'Яндекс Вебмастер',
  yandex_metrika: 'Яндекс Метрика',
  google_search_console: 'Google Search Console',
  indexnow: 'IndexNow (Яндекс, Bing)',
  telegram_channel: 'Telegram-канал',
  vk: 'VK (сообщество)',
};

/** How a platform can receive a post: only `api` is ever automatic. */
export const SEO_PLATFORM_MODES = ['api', 'manual'] as const;
export type SeoPlatformMode = (typeof SEO_PLATFORM_MODES)[number];

export const SEO_EXTERNAL_POST_STATUSES = [
  'draft',
  'ready',
  'scheduled',
  'published',
  'rejected',
  'error',
] as const;
export type SeoExternalPostStatus = (typeof SEO_EXTERNAL_POST_STATUSES)[number];

export const SEO_ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type SeoIssueSeverity = (typeof SEO_ISSUE_SEVERITIES)[number];
export const SEO_ISSUE_STATUSES = ['open', 'fixed', 'ignored', 'needs_approval'] as const;
export type SeoIssueStatus = (typeof SEO_ISSUE_STATUSES)[number];

export const SEO_SEARCH_INTENTS = [
  'informational',
  'navigational',
  'transactional',
  'commercial',
] as const;
export type SeoSearchIntent = (typeof SEO_SEARCH_INTENTS)[number];

export const SEO_LEARNING_KINDS = [
  'observation',
  'pattern',
  'hypothesis',
  'decision',
  'strategy_change',
  'result',
] as const;
export type SeoLearningKind = (typeof SEO_LEARNING_KINDS)[number];

/** Default external platforms (rules are summaries for the admin; the agent re-checks them). */
export const SEO_DEFAULT_PLATFORMS = [
  {
    slug: 'telegram',
    name: 'Telegram-канал Зубрилки',
    mode: 'api',
    format: 'Короткий полезный пост: 600–1200 знаков, список или мини-разбор, одна ссылка.',
    rules: 'Свой канал: бот — администратор канала. Без массовых упоминаний и спама.',
  },
  {
    slug: 'vk',
    name: 'VK (сообщество)',
    mode: 'manual',
    format: 'Пост 800–1500 знаков, карточка с картинкой, вопрос к аудитории в конце.',
    rules:
      'Публикация через API возможна только с токеном сообщества (wall). Без токена — вручную.',
  },
  {
    slug: 'dzen',
    name: 'Дзен',
    mode: 'manual',
    format: 'Большая статья 6–12 тыс. знаков с подзаголовками и картинками.',
    rules: 'Без кликбейта; внешние ссылки — умеренно, по теме. Публичного API публикации нет.',
  },
  {
    slug: 'vc',
    name: 'VC.ru',
    mode: 'manual',
    format: 'Кейс, аналитика или исследование с цифрами и выводами.',
    rules: 'Рекламные материалы — только в разрешённых форматах; авторский взгляд, данные.',
  },
  {
    slug: 'pikabu',
    name: 'Pikabu',
    mode: 'manual',
    format: 'История, мем или обсуждение; ценность в самом посте, ссылка не главное.',
    rules: 'Реклама запрещена правилами; только полезный/развлекательный пост от первого лица.',
  },
  {
    slug: 'reddit',
    name: 'Reddit',
    mode: 'manual',
    format: 'Обсуждение в подходящем сабреддите; ответ на вопрос, а не реклама.',
    rules: 'Соблюдать правила сабреддита и правило самопродвижения Reddit (не больше 10 %).',
  },
] as const satisfies readonly {
  slug: string;
  name: string;
  mode: SeoPlatformMode;
  format: string;
  rules: string;
}[];
