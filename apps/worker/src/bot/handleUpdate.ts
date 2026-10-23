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
  mainKeyboard,
  plainTextReply,
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

async function sendWelcome(ctx: BotContext, chatId: number, first: boolean) {
  const keyboard = mainKeyboard(ctx.siteUrl);
  if (first) {
    await ctx.photos.send(ctx.telegram, chatId, 'welcome', welcomeCaption, {
      parseMode: 'HTML',
      replyMarkup: keyboard,
    });
  } else {
    await ctx.telegram.sendMessage(chatId, welcomeBackText, {
      parseMode: 'HTML',
      replyMarkup: keyboard,
    });
  }
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
  if (command === 'start') {
    const { first } = await recordStart(ctx.db, chatId, message.from.id);
    await sendWelcome(ctx, chatId, first);
  } else if (command === 'ios') {
    await sendIosGuide(ctx, chatId);
  } else if (command === 'help') {
    await ctx.telegram.sendMessage(chatId, helpText, { replyMarkup: mainKeyboard(ctx.siteUrl) });
  } else if (command) {
    await ctx.telegram.sendMessage(chatId, unknownCommandText);
  } else {
    await ctx.telegram.sendMessage(chatId, plainTextReply);
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
