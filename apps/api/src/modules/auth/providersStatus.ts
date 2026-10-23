import type { Config } from '../../config.js';
import { describeBotToken } from './telegram.js';
import { isVkConfigured } from './vk.js';
import { isYandexConfigured } from './yandex.js';

/**
 * One line at startup saying which sign-in methods this process can serve.
 * A sign-in method that is silently "not configured" looks, from the outside,
 * exactly like one that is broken; this makes the difference visible in the
 * logs without printing any secret (the Telegram bot id is the public part
 * of the token before the colon).
 */
export function authProvidersSummary(config: Config) {
  return {
    vk: isVkConfigured(config),
    yandex: isYandexConfigured(config),
    telegram: describeBotToken(config.TELEGRAM_BOT_TOKEN),
  };
}

export function logAuthProviders(
  log: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  },
  config: Config,
): void {
  const summary = authProvidersSummary(config);
  log.info({ authProviders: summary }, 'sign-in methods configured on this server');
  if (!summary.telegram.configured) {
    log.warn(
      { tgAuth: 'not_configured' },
      'TELEGRAM_BOT_TOKEN is empty: Telegram Mini App sign-in answers 503',
    );
  } else if (!summary.telegram.formatLooksValid) {
    log.warn(
      { tgAuth: 'token_format' },
      'TELEGRAM_BOT_TOKEN does not look like <bot id>:<secret>; Telegram sign-in will be rejected',
    );
  }
}
