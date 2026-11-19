import type { SeoDeps } from '../deps.js';
import type { TaskHandler } from '../queue.js';
import { checkIntegrationHandler, syncMetricsHandler } from './analytics.js';
import { reviewArticleHandler, writeArticleHandler } from './content.js';
import { distributeHandler, publishExternalHandler } from './distribution.js';
import { competitorsHandler, researchHandler, scoreTopicsHandler } from './research.js';
import { refreshArticlesHandler, weeklyStrategyHandler } from './strategy.js';
import { postPublishCheckHandler, technicalAuditHandler } from './technical.js';
import { visualsHandler } from './visual.js';

/** Task kind → handler (docs/SEO_CENTER.md §5). Every kind in SEO_TASK_KINDS has one. */
export function analyticsHandlers(deps: SeoDeps): Record<string, TaskHandler> {
  const write = writeArticleHandler(deps);
  return {
    research: researchHandler(deps),
    score_topics: scoreTopicsHandler(deps),
    competitors: competitorsHandler(deps),
    write_article: write,
    update_article: write,
    review_article: reviewArticleHandler(deps),
    visuals: visualsHandler(deps),
    post_publish_check: postPublishCheckHandler(deps),
    distribute: distributeHandler(deps),
    publish_external: publishExternalHandler(deps),
    technical_audit: technicalAuditHandler(deps),
    weekly_strategy: weeklyStrategyHandler(deps),
    refresh_articles: refreshArticlesHandler(deps),
    sync_metrics: syncMetricsHandler(deps),
    check_integration: checkIntegrationHandler(deps),
  };
}
