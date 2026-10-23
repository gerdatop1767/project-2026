import { useState } from 'react';
import type { IdentityProvider } from '@zybrilka/shared';
import {
  ApiError,
  linkTelegram,
  unlinkIdentity,
  vkLinkUrl,
  yandexLinkUrl,
} from '../../../lib/api.js';
import { useAuth } from '../../../lib/authContext.js';
import { getTelegramInitData } from '../../../lib/telegramMiniApp.js';
import { Button } from '../../../ui/Button/Button.js';
import { Icon } from '../../../ui/Icon/Icon.js';
import { VkIcon } from '../../../ui/VkIcon/VkIcon.js';
import { YandexIcon } from '../../../ui/YandexIcon/YandexIcon.js';
import type { IdentitiesState } from './useIdentities.js';
import styles from './Account.module.css';

type Notice = { kind: 'success' | 'error'; text: string } | null;

const PROVIDER_LABEL: Record<IdentityProvider, string> = {
  email: 'Почта и пароль',
  vk: 'ВКонтакте',
  telegram: 'Telegram',
  yandex: 'Яндекс ID',
};

/** What the VK redirect back to /profile?link=… means, in plain words. */
const VK_RESULTS: Record<string, { kind: 'success' | 'error'; text: string }> = {
  ok: { kind: 'success', text: 'ВКонтакте подключён. Теперь в аккаунт можно войти и через него.' },
  already: { kind: 'success', text: 'Этот аккаунт ВКонтакте уже подключён к вашему профилю.' },
  taken: {
    kind: 'error',
    text: 'Этот аккаунт ВКонтакте уже связан с другим профилем Зубрилки. Мы не объединяем профили автоматически: войдите через ВКонтакте, чтобы открыть тот профиль, или подключите другой аккаунт.',
  },
  provider_used: {
    kind: 'error',
    text: 'К вашему профилю уже подключён другой аккаунт ВКонтакте. Сначала отключите его.',
  },
  session_changed: {
    kind: 'error',
    text: 'Во время подключения вы сменили аккаунт. Повторите подключение.',
  },
  error: { kind: 'error', text: 'Не удалось подключить ВКонтакте. Попробуйте ещё раз позже.' },
};

const TELEGRAM_ERRORS: Record<string, string> = {
  identity_taken:
    'Этот аккаунт Telegram уже связан с другим профилем Зубрилки. Мы не объединяем профили автоматически: откройте Зубрилку в Telegram, чтобы войти в тот профиль.',
  provider_already_used:
    'К вашему профилю уже подключён другой аккаунт Telegram. Сначала отключите его.',
  telegram_data_expired:
    'Данные запуска устарели. Закройте Зубрилку в Telegram, откройте снова и повторите.',
  invalid_telegram_data:
    'Не удалось подтвердить аккаунт Telegram. Откройте Зубрилку через бота и повторите.',
  telegram_not_configured: 'Вход через Telegram пока не настроен.',
};

/** Same outcomes for the Yandex ID redirect back to /profile?link=…&provider=yandex. */
const YANDEX_RESULTS: Record<string, { kind: 'success' | 'error'; text: string }> = {
  ok: { kind: 'success', text: 'Яндекс ID подключён. Теперь в аккаунт можно войти и через него.' },
  already: { kind: 'success', text: 'Этот аккаунт Яндекса уже подключён к вашему профилю.' },
  taken: {
    kind: 'error',
    text: 'Этот аккаунт Яндекса уже связан с другим профилем Зубрилки. Мы не объединяем профили автоматически: войдите через Яндекс, чтобы открыть тот профиль, или подключите другой аккаунт.',
  },
  provider_used: {
    kind: 'error',
    text: 'К вашему профилю уже подключён другой аккаунт Яндекса. Сначала отключите его.',
  },
  session_changed: {
    kind: 'error',
    text: 'Во время подключения вы сменили аккаунт. Повторите подключение.',
  },
  cancelled: { kind: 'error', text: 'Подключение Яндекса отменено.' },
  not_configured: { kind: 'error', text: 'Вход через Яндекс пока не настроен.' },
  error: { kind: 'error', text: 'Не удалось подключить Яндекс. Попробуйте ещё раз позже.' },
};

function readLinkResult(): Notice {
  try {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('link');
    const provider = params.get('provider');
    if (!result || (provider !== 'vk' && provider !== 'yandex')) return null;
    // One-shot: don't show it again after a reload or when sharing the URL.
    params.delete('link');
    params.delete('provider');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    const table = provider === 'yandex' ? YANDEX_RESULTS : VK_RESULTS;
    return table[result] ?? table.error!;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
}

/**
 * «Способы входа»: which sign-in methods are attached to THIS account, with
 * connect / disconnect. Connecting is always done from the signed-in
 * account and proven by the provider (VK OAuth redirect, or Telegram's signed
 * launch data inside the Mini App); the server never merges two accounts and
 * never lets the last method be removed.
 */
export function SignInMethodsSection({
  identities,
  navigateTo = (url: string) => window.location.assign(url),
}: {
  identities: IdentitiesState;
  /** Seam for tests: performs the full-page redirect to the provider. */
  navigateTo?: (url: string) => void;
}) {
  const { updateUser } = useAuth();
  const { data, failed: loadFailed, reload: load, replace: setData } = identities;
  const [busy, setBusy] = useState<IdentityProvider | null>(null);
  const [confirming, setConfirming] = useState<IdentityProvider | null>(null);
  const [notice, setNotice] = useState<Notice>(() => readLinkResult());

  async function connectTelegram() {
    const initData = getTelegramInitData();
    if (!initData) return;
    setBusy('telegram');
    setNotice(null);
    try {
      const res = await linkTelegram(initData);
      updateUser(res.user);
      setNotice({
        kind: 'success',
        text:
          res.status === 'linked'
            ? 'Telegram подключён. Теперь в аккаунт можно войти и через него.'
            : 'Этот аккаунт Telegram уже подключён к вашему профилю.',
      });
      load();
    } catch (error) {
      const code =
        error instanceof ApiError ? (error.body as { error?: string })?.error : undefined;
      setNotice({
        kind: 'error',
        text:
          (code && TELEGRAM_ERRORS[code]) ||
          'Не удалось подключить Telegram. Проверьте соединение и повторите.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: IdentityProvider) {
    setBusy(provider);
    setNotice(null);
    try {
      setData(await unlinkIdentity(provider));
      setConfirming(null);
      setNotice({ kind: 'success', text: `${PROVIDER_LABEL[provider]} отключён.` });
    } catch (error) {
      const code =
        error instanceof ApiError ? (error.body as { error?: string })?.error : undefined;
      setNotice({
        kind: 'error',
        text:
          code === 'last_identity'
            ? 'Это единственный способ входа — отключить его нельзя, иначе вы потеряете доступ к аккаунту.'
            : 'Не удалось отключить способ входа. Повторите позже.',
      });
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  }

  const insideTelegram = getTelegramInitData() !== null;

  function renderRow(provider: IdentityProvider) {
    const linked = data?.identities.find((identity) => identity.provider === provider);
    const available = provider === 'email' ? false : data!.available[provider];
    // Nothing to offer: not linked and cannot be linked here.
    if (!linked && provider === 'email') return null;
    if (!linked && !available) return null;

    return (
      <li key={provider} className={styles.methodRow}>
        <span className={styles.methodIcon} aria-hidden="true">
          {provider === 'vk' ? (
            <VkIcon size={22} />
          ) : provider === 'yandex' ? (
            <YandexIcon size={22} />
          ) : (
            <Icon name={provider === 'email' ? 'mail' : 'chat'} size={20} />
          )}
        </span>
        <span className={styles.methodText}>
          <span className="text-body" style={{ fontWeight: 600 }}>
            {PROVIDER_LABEL[provider]}
          </span>
          <span className="text-body-sm text-secondary">
            {linked
              ? `Подключено${formatDate(linked.linkedAt) ? ` · ${formatDate(linked.linkedAt)}` : ''}`
              : provider === 'telegram' && !insideTelegram
                ? 'Откройте Зубрилку в Telegram, чтобы подключить'
                : 'Не подключено'}
          </span>
        </span>
        <span className={styles.methodAction}>
          {linked && data!.canUnlink && confirming !== provider && (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirming(provider)}
              aria-label={`Отключить ${PROVIDER_LABEL[provider]}`}
            >
              Отключить
            </Button>
          )}
          {!linked && provider === 'vk' && (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => navigateTo(vkLinkUrl())}
            >
              Подключить
            </Button>
          )}
          {!linked && provider === 'yandex' && (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => navigateTo(yandexLinkUrl())}
            >
              Подключить
            </Button>
          )}
          {!linked && provider === 'telegram' && insideTelegram && (
            <Button
              variant="secondary"
              loading={busy === 'telegram'}
              disabled={busy !== null}
              onClick={connectTelegram}
            >
              Подключить
            </Button>
          )}
        </span>
        {confirming === provider && (
          <div className={styles.confirm} role="alertdialog" aria-label="Подтверждение">
            <p className="text-body-sm">
              Отключить {PROVIDER_LABEL[provider]}? Войти этим способом больше не получится.
              Прогресс и данные аккаунта останутся.
            </p>
            <div className={styles.buttonRow}>
              <Button
                variant="destructive"
                loading={busy === provider}
                onClick={() => disconnect(provider)}
              >
                Отключить
              </Button>
              <Button
                variant="secondary"
                disabled={busy === provider}
                onClick={() => setConfirming(null)}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="sign-in-methods-title">
      <h2 id="sign-in-methods-title" className="text-h3">
        Способы входа
      </h2>
      <p className="text-body-sm text-secondary">
        Подключите несколько способов — и входите в один и тот же аккаунт с одним прогрессом.
      </p>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`text-body-sm ${notice.kind === 'error' ? styles.error : styles.success}`}
        >
          {notice.text}
        </p>
      )}

      {!data && !loadFailed && (
        <p className="text-body-sm text-secondary" role="status">
          Загружаем способы входа…
        </p>
      )}
      {loadFailed && (
        <div className={styles.loadError}>
          <p role="alert" className={`text-body-sm ${styles.error}`}>
            Не удалось загрузить способы входа.
          </p>
          <Button variant="secondary" onClick={load}>
            Повторить
          </Button>
        </div>
      )}
      {data && (
        <ul className={styles.methodList}>
          {(['email', 'vk', 'yandex', 'telegram'] as const).map((provider) => renderRow(provider))}
        </ul>
      )}
    </section>
  );
}
