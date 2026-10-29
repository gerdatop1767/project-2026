import { claimTelegramLinkToken, previewTelegramLink, schema } from '@zybrilka/db';
import { supportTexts } from '@zybrilka/shared';
import type { Database } from '@zybrilka/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  TelegramApiError,
  type TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
} from '../telegram/client.js';
import {
  CALLBACK_IOS_GUIDE,
  CALLBACK_LINK_NO,
  CALLBACK_LINK_PREFIX,
  CALLBACK_REMINDERS_OFF,
  CALLBACK_SUPPORT_CLOSE,
  linkClaimedKeyboard,
  linkClaimedText,
  linkDeclinedText,
  linkFailedText,
  linkQuestionKeyboard,
  linkQuestionText,
  linkResultText,
  remindersNoAccountText,
  remindersOffText,
  supportAlreadyOpenText,
  supportCloseKeyboard,
  supportSaveFailedText,
  helpText,
  iosGuideCaption,
  iosGuideKeyboard,
  keyboardButtonOf,
  mainKeyboard,
  mainMenuText,
  persistentKeyboard,
  plainTextReply,
  splitCaption,
  unknownCommandText,
  welcomeBackText,
  welcomeCaption,
} from './messages.js';
import { errorSummary } from '../errorSummary.js';
import type { BotPhotos } from './photos.js';
import {
  closeSupportByUser,
  disableRemindersFor,
  openThreadOf,
  receiveSupportMessage,
  requestSupport,
  supportContentOf,
} from './support.js';

export interface BotContext {
  db: Database;
  telegram: TelegramClient;
  photos: BotPhotos;
  siteUrl: string;
  logger: Logger;
  /** For tests: the pause before re-sending what never reached Telegram. */
  retryDelayMs?: number;
}

/** The database is asked before the reply (first or repeated /start); a slow
 * or failing database must not keep the user waiting longer than this. */
const DB_TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 700;

/** Stage durations of one update, for the «telegram update» log line. */
type Timings = Record<string, number>;

async function measure<T>(timings: Timings, stage: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    timings[stage] = Math.round((timings[stage] ?? 0) + performance.now() - started);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The request provably never reached Telegram: safe to send again. */
const notSent = (error: unknown) =>
  error instanceof TelegramApiError &&
  error.kind === 'network' &&
  error.network?.maybeDelivered === false;

/** Telegram may have shown it already: sending again could duplicate it. */
const maybeShown = (error: unknown) =>
  error instanceof TelegramApiError &&
  error.kind === 'network' &&
  error.network?.maybeDelivered !== false;

/**
 * Records a /start: one row per private chat, however many times it is
 * pressed (`start_count` grows, nothing is duplicated). Links the chat to
 * the Zubrilka account that signed in with this Telegram user, if any —
 * the bot itself never creates accounts. Returns whether this was the
 * chat's first /start.
 */
export async function recordStart(db: Database, chatId: number, telegramUserId: number) {
  const [identity] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        eq(schema.authIdentities.providerUserId, String(telegramUserId)),
      ),
    )
    .limit(1);
  const userId = identity?.userId ?? null;
  const [row] = await db
    .insert(schema.telegramBotChats)
    .values({ chatId, userId })
    .onConflictDoUpdate({
      target: schema.telegramBotChats.chatId,
      set: {
        startCount: sql`${schema.telegramBotChats.startCount} + 1`,
        lastStartedAt: new Date(),
        blockedAt: null,
        userId: sql`coalesce(excluded.user_id, ${schema.telegramBotChats.userId})`,
      },
    })
    .returning({ startCount: schema.telegramBotChats.startCount });
  return { first: row!.startCount === 1, userId };
}

/** `/start`, `/start payload`, `/start@bot` → 'start'. */
function commandOf(text: string): string | null {
  const match = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** `/start link_<token>` → the token (the site's «Привязать Telegram»). */
function linkTokenOf(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+link_([A-Za-z0-9_-]{16,64})\s*$/i.exec(text.trim());
  return match ? match[1]! : null;
}

/**
 * The main menu: the site and iOS buttons (inline). Always the last
 * message of the welcome block and of a repeated /start.
 */
async function sendMainMenu(ctx: BotContext, chatId: number, timings: Timings) {
  await measure(timings, 'menu', () =>
    ctx.telegram.sendMessage(chatId, mainMenuText, {
      parseMode: 'HTML',
      replyMarkup: mainKeyboard(ctx.siteUrl),
    }),
  );
}

/**
 * The welcome photo with the greeting as caption and the bottom keyboard.
 * A send that provably never reached Telegram is retried once; if the photo
 * still cannot go out, the greeting goes as text (with the keyboard) so the
 * user always gets an answer. A failure after which Telegram may already
 * show the photo (timeout, broken connection) is not repeated — no double
 * welcome. Returns how it went, for the log.
 */
async function sendWelcomePhoto(
  ctx: BotContext,
  chatId: number,
  timings: Timings,
): Promise<'photo' | 'text' | 'uncertain'> {
  const { caption, rest } = splitCaption(welcomeCaption);
  const options = { parseMode: 'HTML' as const, replyMarkup: persistentKeyboard };
  const sendPhoto = () =>
    measure(timings, 'photo', () =>
      ctx.photos.send(ctx.telegram, chatId, 'welcome', caption, options),
    );
  try {
    try {
      await sendPhoto();
    } catch (error) {
      if (!notSent(error)) throw error;
      await new Promise((r) => setTimeout(r, ctx.retryDelayMs ?? RETRY_DELAY_MS));
      await sendPhoto();
    }
  } catch (error) {
    if (maybeShown(error)) {
      ctx.logger.warn(
        { kind: 'network', code: (error as TelegramApiError).network?.code ?? null },
        'telegram welcome photo: outcome unknown, not resent',
      );
      return 'uncertain';
    }
    // Blocked bot / bad token: nothing else will get through either.
    if (error instanceof TelegramApiError && ['unreachable', 'unauthorized'].includes(error.kind)) {
      throw error;
    }
    ctx.logger.warn(
      { kind: error instanceof TelegramApiError ? error.kind : 'unknown' },
      'telegram welcome photo failed, sending the text instead',
    );
    await measure(timings, 'text', () => ctx.telegram.sendMessage(chatId, welcomeCaption, options));
    return 'text';
  }
  if (rest)
    await measure(timings, 'text', () =>
      ctx.telegram.sendMessage(chatId, rest, { parseMode: 'HTML' }),
    );
  return 'photo';
}

/**
 * The welcome block: the welcome photo with the greeting as its caption and
 * the persistent «📚 Меню / 💬 Поддержка» keyboard, then the main menu (a
 * message has room for one keyboard only, so the inline menu follows as the
 * next message). Sent by the first /start and by «📚 Меню» / /menu — one
 * implementation, so the two never drift apart. The photo goes by its
 * Telegram file_id after the first upload. The menu is sent whatever
 * happened to the photo.
 */
async function sendWelcomeBlock(ctx: BotContext, chatId: number, timings: Timings) {
  const photo = await sendWelcomePhoto(ctx, chatId, timings);
  await sendMainMenu(ctx, chatId, timings);
  return photo;
}

/** /start: the welcome block the first time; afterwards a short welcome
 * back (with the keyboard) and the menu. Nothing piles up or repeats. */
async function sendWelcome(ctx: BotContext, chatId: number, first: boolean, timings: Timings) {
  if (first) {
    await sendWelcomeBlock(ctx, chatId, timings);
    return;
  }
  await measure(timings, 'text', () =>
    ctx.telegram.sendMessage(chatId, welcomeBackText, {
      parseMode: 'HTML',
      replyMarkup: persistentKeyboard,
    }),
  );
  await sendMainMenu(ctx, chatId, timings);
}

async function sendIosGuide(ctx: BotContext, chatId: number) {
  await ctx.photos.send(ctx.telegram, chatId, 'iosGuide', iosGuideCaption(ctx.siteUrl), {
    parseMode: 'HTML',
    replyMarkup: iosGuideKeyboard(ctx.siteUrl),
  });
}

type Action =
  | 'start'
  | 'link'
  | 'menu'
  | 'support'
  | 'support_message'
  | 'reminders_off'
  | 'ios'
  | 'help'
  | 'unknown_command'
  | 'text'
  | 'ignored';

async function handleMessage(
  ctx: BotContext,
  message: TelegramMessage,
  timings: Timings,
): Promise<Action> {
  // Groups and channels: the bot is personal; it stays silent there.
  if (message.chat.type !== 'private' || !message.from || message.from.is_bot) return 'ignored';
  const chatId = message.chat.id;
  const command = message.text ? commandOf(message.text) : null;
  // A tap on the bottom keyboard arrives as its button's text.
  const button = !command && message.text ? keyboardButtonOf(message.text) : null;
  const reply = (text: string, options: Parameters<TelegramClient['sendMessage']>[2]) =>
    measure(timings, 'text', () => ctx.telegram.sendMessage(chatId, text, options));

  const linkToken = command === 'start' && message.text ? linkTokenOf(message.text) : null;
  if (linkToken) {
    try {
      await measure(timings, 'db', () =>
        withTimeout(recordStart(ctx.db, chatId, message.from!.id), DB_TIMEOUT_MS, 'recordStart'),
      );
      // Nothing changes yet: the bot only asks whether this is their account.
      const preview = await measure(timings, 'db', () =>
        withTimeout(
          previewTelegramLink(ctx.db, linkToken, message.from!.id),
          DB_TIMEOUT_MS,
          'link',
        ),
      );
      ctx.logger.info({ link: preview.status }, 'telegram link');
      if (preview.status === 'ok') {
        await reply(linkQuestionText(preview.accountLabel), {
          replyMarkup: linkQuestionKeyboard(linkToken),
        });
      } else {
        await reply(linkResultText(preview.status), { replyMarkup: persistentKeyboard });
      }
    } catch (error) {
      ctx.logger.error(errorSummary(error), 'telegram link failed');
      await reply(linkFailedText, { replyMarkup: persistentKeyboard });
    }
    return 'link';
  }
  if (command === 'start') {
    // Whether this is the first /start decides the reply. If the database
    // is slow or down, answer anyway (with the full welcome) — the user is
    // never left waiting on it.
    let first = true;
    try {
      ({ first } = await measure(timings, 'db', () =>
        withTimeout(recordStart(ctx.db, chatId, message.from!.id), DB_TIMEOUT_MS, 'recordStart'),
      ));
    } catch (error) {
      ctx.logger.error({ err: error }, 'telegram /start: chat not recorded, answering anyway');
    }
    await sendWelcome(ctx, chatId, first, timings);
    return 'start';
  }
  if (command === 'ios') {
    await measure(timings, 'photo', () => sendIosGuide(ctx, chatId));
    return 'ios';
  }
  if (command === 'help') {
    await reply(helpText, { replyMarkup: mainKeyboard(ctx.siteUrl) });
    return 'help';
  }
  if (command === 'menu' || button === 'menu') {
    await sendWelcomeBlock(ctx, chatId, timings);
    return 'menu';
  }
  if (command === 'support' || button === 'support') {
    const { open } = await measure(timings, 'db', () =>
      withTimeout(requestSupport(ctx.db, chatId), DB_TIMEOUT_MS, 'requestSupport'),
    );
    if (open) {
      await reply(supportAlreadyOpenText, { replyMarkup: supportCloseKeyboard });
    } else {
      await reply(supportTexts.prompt, { replyMarkup: persistentKeyboard });
    }
    return 'support';
  }
  if (command === 'reminders_off') {
    const done = await measure(timings, 'db', () =>
      withTimeout(disableRemindersFor(ctx.db, message.from!.id), DB_TIMEOUT_MS, 'reminders'),
    );
    await reply(done ? remindersOffText : remindersNoAccountText, {
      replyMarkup: persistentKeyboard,
    });
    return 'reminders_off';
  }
  if (command) {
    await reply(unknownCommandText, { replyMarkup: persistentKeyboard });
    return 'unknown_command';
  }
  // Not a command or a button: maybe a support message.
  const content = supportContentOf(message);
  if (content === null) {
    // A voice note, sticker, video…: say so if support is in progress.
    const inSupport = await measure(timings, 'db', () =>
      withTimeout(openThreadOf(ctx.db, chatId), DB_TIMEOUT_MS, 'openThread'),
    ).catch(() => null);
    await reply(inSupport ? supportTexts.unsupported : plainTextReply, {
      replyMarkup: persistentKeyboard,
    });
    return inSupport ? 'support_message' : 'text';
  }
  let received: Awaited<ReturnType<typeof receiveSupportMessage>>;
  try {
    received = await measure(timings, 'db', () =>
      withTimeout(
        receiveSupportMessage(ctx.db, chatId, message.from!.id, message, content),
        DB_TIMEOUT_MS,
        'supportMessage',
      ),
    );
  } catch (error) {
    // Never pretend it was received: the user is asked to send it again.
    ctx.logger.error(errorSummary(error), 'support message not stored');
    await reply(supportSaveFailedText, { replyMarkup: persistentKeyboard });
    return 'support_message';
  }
  if (received.outcome === 'opened') {
    await reply(supportTexts.received, { replyMarkup: supportCloseKeyboard });
    return 'support_message';
  }
  if (received.outcome === 'appended') {
    await reply(supportTexts.appended, { replyMarkup: persistentKeyboard });
    return 'support_message';
  }
  if (received.outcome === 'duplicate') return 'support_message';
  // Replies without inline buttons carry the bottom keyboard, so a chat
  // started before it existed gets it without an extra message.
  await reply(plainTextReply, { replyMarkup: persistentKeyboard });
  return 'text';
}

/**
 * One update from getUpdates. Only what users can do is handled: there are
 * no admin commands in the bot at all (admin work is in the site's admin
 * panel), so nothing here trusts who the sender claims to be.
 */
export async function handleUpdate(ctx: BotContext, update: TelegramUpdate): Promise<void> {
  const started = performance.now();
  const timings: Timings = {};
  let action: Action | 'ios_button' | 'support_close' | 'link_claim' | 'callback' = 'ignored';
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    if (update.message) {
      action = await handleMessage(ctx, update.message, timings);
    } else if (update.callback_query) {
      const query = update.callback_query;
      // Stop the button's spinner first; the guide (an upload) may take a moment.
      await measure(timings, 'answer', () =>
        ctx.telegram.answerCallbackQuery(query.id).catch(() => undefined),
      );
      const privateChat = query.message?.chat.type === 'private' ? query.message.chat.id : null;
      if (query.data === CALLBACK_IOS_GUIDE && privateChat !== null) {
        action = 'ios_button';
        await measure(timings, 'photo', () => sendIosGuide(ctx, privateChat));
      } else if (query.data === CALLBACK_SUPPORT_CLOSE && privateChat !== null) {
        action = 'support_close';
        const closed = await measure(timings, 'db', () =>
          withTimeout(closeSupportByUser(ctx.db, privateChat), DB_TIMEOUT_MS, 'closeSupport'),
        );
        await measure(timings, 'text', () =>
          ctx.telegram.sendMessage(
            privateChat,
            closed ? supportTexts.closedByUser : 'Открытых обращений нет.',
            { replyMarkup: persistentKeyboard },
          ),
        );
      } else if (query.data?.startsWith(CALLBACK_LINK_PREFIX) && privateChat !== null) {
        action = 'link_claim';
        const token = query.data.slice(CALLBACK_LINK_PREFIX.length);
        // The button's own user, as Telegram reports them — never a name
        // or id taken from the message text.
        // Shown to the account owner on the site; the @username (unique,
        // from Telegram) tells a look-alike display name apart.
        const name = [
          query.from.first_name,
          query.from.last_name,
          query.from.username ? `(@${query.from.username})` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        let text: string;
        let claimed = false;
        try {
          const claim = await measure(timings, 'db', () =>
            withTimeout(
              claimTelegramLinkToken(ctx.db, token, query.from.id, name),
              DB_TIMEOUT_MS,
              'link',
            ),
          );
          ctx.logger.info({ link: claim.status }, 'telegram link claim');
          claimed = claim.status === 'claimed';
          text = claim.status === 'claimed' ? linkClaimedText : linkResultText(claim.status);
        } catch (error) {
          ctx.logger.error(errorSummary(error), 'telegram link claim failed');
          text = linkFailedText;
        }
        const backToSite = claimed ? linkClaimedKeyboard(ctx.siteUrl) : null;
        await measure(timings, 'text', () =>
          ctx.telegram.sendMessage(privateChat, text, {
            replyMarkup: backToSite ?? persistentKeyboard,
          }),
        );
      } else if (query.data === CALLBACK_LINK_NO && privateChat !== null) {
        action = 'link_claim';
        await measure(timings, 'text', () =>
          ctx.telegram.sendMessage(privateChat, linkDeclinedText, {
            replyMarkup: persistentKeyboard,
          }),
        );
      } else if (query.data === CALLBACK_REMINDERS_OFF && privateChat !== null) {
        action = 'reminders_off';
        // The button's own user — not whoever the message was sent to.
        const done = await measure(timings, 'db', () =>
          withTimeout(disableRemindersFor(ctx.db, query.from.id), DB_TIMEOUT_MS, 'reminders'),
        );
        await measure(timings, 'text', () =>
          ctx.telegram.sendMessage(privateChat, done ? remindersOffText : remindersNoAccountText, {
            replyMarkup: persistentKeyboard,
          }),
        );
      } else {
        action = 'callback';
      }
    }
    outcome = 'ok';
  } finally {
    // Stage durations only — never the message text, names or the token.
    ctx.logger.info(
      {
        updateId: update.update_id,
        action,
        outcome,
        ms: timings,
        totalMs: Math.round(performance.now() - started),
      },
      'telegram update',
    );
  }
}
