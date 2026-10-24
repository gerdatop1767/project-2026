import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { TelegramClient, TelegramMessage, TelegramUpdate } from '../telegram/client.js';
import {
  CALLBACK_IOS_GUIDE,
  helpText,
  iosGuideCaption,
  iosGuideKeyboard,
  keyboardButtonOf,
  mainKeyboard,
  mainMenuText,
  persistentKeyboard,
  plainTextReply,
  splitCaption,
  supportText,
  unknownCommandText,
  welcomeBackText,
  welcomeCaption,
} from './messages.js';
import type { BotPhotos } from './photos.js';

export interface BotContext {
  db: Database;
  telegram: TelegramClient;
  photos: BotPhotos;
  siteUrl: string;
  logger: Logger;
}

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

/**
 * The main menu: the site and iOS buttons (inline). Always the last
 * message of the welcome block and of a repeated /start.
 */
async function sendMainMenu(ctx: BotContext, chatId: number) {
  await ctx.telegram.sendMessage(chatId, mainMenuText, {
    parseMode: 'HTML',
    replyMarkup: mainKeyboard(ctx.siteUrl),
  });
}

/**
 * The welcome block: the welcome photo with the greeting as its caption and
 * the persistent «📚 Меню / 💬 Поддержка» keyboard, then the main menu (a
 * message has room for one keyboard only, so the inline menu follows as the
 * next message). Sent by the first /start and by «📚 Меню» / /menu — one
 * implementation, so the two never drift apart. The photo goes by its
 * Telegram file_id after the first upload.
 */
async function sendWelcomeBlock(ctx: BotContext, chatId: number) {
  const { caption, rest } = splitCaption(welcomeCaption);
  await ctx.photos.send(ctx.telegram, chatId, 'welcome', caption, {
    parseMode: 'HTML',
    replyMarkup: persistentKeyboard,
  });
  if (rest) await ctx.telegram.sendMessage(chatId, rest, { parseMode: 'HTML' });
  await sendMainMenu(ctx, chatId);
}

/** /start: the welcome block the first time; afterwards a short welcome
 * back (with the keyboard) and the menu. Nothing piles up or repeats. */
async function sendWelcome(ctx: BotContext, chatId: number, first: boolean) {
  if (first) {
    await sendWelcomeBlock(ctx, chatId);
    return;
  }
  await ctx.telegram.sendMessage(chatId, welcomeBackText, {
    parseMode: 'HTML',
    replyMarkup: persistentKeyboard,
  });
  await sendMainMenu(ctx, chatId);
}

async function sendIosGuide(ctx: BotContext, chatId: number) {
  await ctx.photos.send(ctx.telegram, chatId, 'iosGuide', iosGuideCaption(ctx.siteUrl), {
    parseMode: 'HTML',
    replyMarkup: iosGuideKeyboard(ctx.siteUrl),
  });
}

async function handleMessage(ctx: BotContext, message: TelegramMessage) {
  // Groups and channels: the bot is personal; it stays silent there.
  if (message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
  const chatId = message.chat.id;
  const command = message.text ? commandOf(message.text) : null;
  // A tap on the bottom keyboard arrives as its button's text.
  const button = !command && message.text ? keyboardButtonOf(message.text) : null;
  if (command === 'start') {
    const { first } = await recordStart(ctx.db, chatId, message.from.id);
    await sendWelcome(ctx, chatId, first);
  } else if (command === 'ios') {
    await sendIosGuide(ctx, chatId);
  } else if (command === 'help') {
    await ctx.telegram.sendMessage(chatId, helpText, { replyMarkup: mainKeyboard(ctx.siteUrl) });
  } else if (command === 'menu' || button === 'menu') {
    await sendWelcomeBlock(ctx, chatId);
  } else if (command === 'support' || button === 'support') {
    await ctx.telegram.sendMessage(chatId, supportText, { replyMarkup: persistentKeyboard });
  } else if (command) {
    await ctx.telegram.sendMessage(chatId, unknownCommandText, { replyMarkup: persistentKeyboard });
  } else {
    // Replies without inline buttons carry the bottom keyboard, so a chat
    // started before it existed gets it without an extra message.
    await ctx.telegram.sendMessage(chatId, plainTextReply, { replyMarkup: persistentKeyboard });
  }
}

/**
 * One update from getUpdates. Only what users can do is handled: there are
 * no admin commands in the bot at all (admin work is in the site's admin
 * panel), so nothing here trusts who the sender claims to be.
 */
export async function handleUpdate(ctx: BotContext, update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await handleMessage(ctx, update.message);
    return;
  }
  const query = update.callback_query;
  if (query) {
    if (query.data === CALLBACK_IOS_GUIDE && query.message?.chat.type === 'private') {
      // Stop the button's spinner first; the guide (an upload) may take a moment.
      await ctx.telegram.answerCallbackQuery(query.id).catch(() => undefined);
      await sendIosGuide(ctx, query.message.chat.id);
    } else {
      await ctx.telegram.answerCallbackQuery(query.id).catch(() => undefined);
    }
  }
}
