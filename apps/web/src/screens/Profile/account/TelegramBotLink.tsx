import { useEffect, useState } from 'react';
import { cancelTelegramLink, confirmTelegramLink, createTelegramLink } from '../../../lib/api.js';
import { clsx } from '../../../lib/clsx.js';
import { SUPPORT_BOT_URL } from '../../../lib/telegram.js';
import { Button } from '../../../ui/Button/Button.js';
import buttonStyles from '../../../ui/Button/Button.module.css';
import styles from './Account.module.css';

type Notice = { kind: 'success' | 'error'; text: string };

const CONFIRM_RESULTS: Record<string, Notice> = {
  linked: {
    kind: 'success',
    text: 'Telegram подключён. Теперь в аккаунт можно войти и через него.',
  },
  already_linked: { kind: 'success', text: 'Этот Telegram уже подключён к вашему профилю.' },
  taken: {
    kind: 'error',
    text: 'Этот Telegram уже связан с другим профилем Зубрилки — ничего не изменилось. Мы не объединяем профили автоматически.',
  },
  provider_already_used: {
    kind: 'error',
    text: 'К профилю уже подключён другой Telegram. Сначала отключите его.',
  },
  nothing_pending: {
    kind: 'error',
    text: 'Запрос устарел или отменён — нажмите «Привязать Telegram» ещё раз.',
  },
  rejected: { kind: 'success', text: 'Запрос отклонён, Telegram не привязан.' },
};

type Step =
  | { kind: 'idle' }
  | { kind: 'creating' }
  /** The bot link is ready: the student opens it with their own tap. */
  | { kind: 'open'; url: string; expiresAt: number };

/**
 * «Привязать Telegram» outside the Mini App — Safari on iPhone, any
 * browser (docs/REMINDERS.md). The account is the one signed in here; the
 * bot proves which Telegram it is:
 * 1. a one-time link (15 minutes) to @zybrilka_bot is made for THIS
 *    account and opened with the student's own tap — a real link, so
 *    Safari never blocks it as a pop-up;
 * 2. in the bot they confirm «Да, это мой аккаунт»;
 * 3. back here, the Telegram that confirmed is shown by name and the
 *    owner accepts or refuses it. Only then is it linked.
 * The token lives only in that link: never in this page's address, the
 * console or an error message.
 */
export function TelegramBotLink({
  pendingName,
  reload,
  onLinked,
}: {
  /** The Telegram that confirmed in the bot, waiting for the owner. */
  pendingName: string | null;
  /** Reload the sign-in methods (and so the pending state). */
  reload: () => void;
  /** Linked: the row turns «Подключено», so the message is shown above. */
  onLinked: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Back from Telegram (another app on iPhone): look again.
  useEffect(() => {
    if (step.kind !== 'open') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [step.kind, reload]);

  async function start() {
    setStep({ kind: 'creating' });
    setNotice(null);
    try {
      const { token, expiresAt } = await createTelegramLink();
      setNow(Date.now());
      setStep({
        kind: 'open',
        url: `${SUPPORT_BOT_URL}?start=link_${token}`,
        expiresAt: new Date(expiresAt).getTime(),
      });
    } catch {
      setStep({ kind: 'idle' });
      setNotice({
        kind: 'error',
        text: 'Не получилось создать ссылку. Проверьте соединение и попробуйте ещё раз.',
      });
    }
  }

  async function cancel() {
    setStep({ kind: 'idle' });
    setNotice(null);
    try {
      await cancelTelegramLink();
      setNotice({ kind: 'success', text: 'Привязка отменена — ссылка больше не работает.' });
    } catch {
      setNotice({
        kind: 'error',
        text: 'Не удалось отменить ссылку. Она перестанет работать через 15 минут.',
      });
    }
    reload();
  }

  async function answer(accept: boolean) {
    setAnswering(true);
    setNotice(null);
    try {
      const { status } = await confirmTelegramLink(accept);
      const result = CONFIRM_RESULTS[status] ?? CONFIRM_RESULTS.nothing_pending!;
      setStep({ kind: 'idle' });
      if (status === 'linked' || status === 'already_linked') onLinked(result.text);
      else setNotice(result);
    } catch {
      setNotice({
        kind: 'error',
        text: 'Не удалось ответить на запрос. Проверьте соединение и попробуйте ещё раз.',
      });
    } finally {
      setAnswering(false);
      reload();
    }
  }

  const noticeView = notice && (
    <p
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={clsx('text-body-sm', notice.kind === 'error' ? styles.error : styles.success)}
    >
      {notice.text}
    </p>
  );

  if (pendingName !== null) {
    return (
      <div className={styles.confirm} role="group" aria-label="Запрос на привязку Telegram">
        <p className="text-body-sm">
          Telegram «<b>{pendingName}</b>» хочет привязаться к этому профилю. Это вы?
        </p>
        <p className="text-body-sm text-secondary">
          Привязанный Telegram сможет входить в этот профиль. Если это не вы — нажмите «Это не я».
        </p>
        <div className={styles.buttonRow}>
          <Button loading={answering} onClick={() => void answer(true)}>
            Подтвердить
          </Button>
          <Button variant="secondary" disabled={answering} onClick={() => void answer(false)}>
            Это не я
          </Button>
        </div>
        {noticeView}
      </div>
    );
  }

  if (step.kind === 'open') {
    const expired = now >= step.expiresAt;
    return (
      <div className={styles.confirm}>
        {expired ? (
          <>
            <p className="text-body-sm">Ссылка устарела — она действует 15 минут.</p>
            <div className={styles.buttonRow}>
              <Button onClick={() => void start()}>Получить новую ссылку</Button>
              <Button variant="secondary" onClick={() => setStep({ kind: 'idle' })}>
                Отмена
              </Button>
            </div>
          </>
        ) : (
          <>
            <ol className={clsx('text-body-sm', styles.steps)}>
              <li>Откройте бота кнопкой ниже и нажмите «Запустить».</li>
              <li>В боте нажмите «Да, это мой аккаунт».</li>
              <li>Вернитесь сюда и подтвердите привязку.</li>
            </ol>
            <div className={styles.buttonRow}>
              <a
                className={clsx(buttonStyles.button, buttonStyles.primary)}
                href={step.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Открыть @zybrilka_bot
              </a>
              <Button variant="secondary" onClick={reload}>
                Я подтвердил в боте
              </Button>
              <Button variant="ghost" onClick={() => void cancel()}>
                Отмена
              </Button>
            </div>
            <p className="text-body-sm text-secondary">Ссылка одноразовая и действует 15 минут.</p>
          </>
        )}
        {noticeView}
      </div>
    );
  }

  return (
    <div className={styles.confirm}>
      <div className={styles.buttonRow}>
        <Button variant="secondary" loading={step.kind === 'creating'} onClick={() => void start()}>
          Привязать Telegram
        </Button>
      </div>
      {noticeView}
    </div>
  );
}
