import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq } from 'drizzle-orm';
import {
  largestPhotoId,
  type ChatId,
  type SendOptions,
  type TelegramClient,
  type TelegramMessage,
} from '../telegram/client.js';

/** The bot's images, kept in apps/worker/assets (sources in assets/source). */
export const BOT_IMAGES = {
  welcome: 'welcome.png',
  iosGuide: 'ios-install.png',
} as const;
export type BotImage = keyof typeof BOT_IMAGES;

const SETTINGS_KEY = 'telegram.bot_file_ids';
// src/bot/*.ts and dist/bot/*.js both sit two levels below the package root.
const ASSETS = new URL('../../assets/', import.meta.url);

/**
 * Sends a bundled image, uploading it only once: Telegram returns a
 * `file_id` for the uploaded photo, which is reused for every later send
 * (kept in memory and in `app_settings`, keyed by the file's hash, so an
 * updated image is uploaded again rather than an old id reused).
 */
export class BotPhotos {
  private cache: Record<string, string> | null = null;
  private files = new Map<BotImage, { bytes: Uint8Array; hash: string }>();

  constructor(
    private readonly db: Database | undefined,
    private readonly readAsset: (name: string) => Promise<Uint8Array> = (name) =>
      readFile(new URL(name, ASSETS)),
  ) {}

  private async file(image: BotImage) {
    let entry = this.files.get(image);
    if (!entry) {
      const bytes = await this.readAsset(BOT_IMAGES[image]);
      entry = { bytes, hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
      this.files.set(image, entry);
    }
    return entry;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    this.cache = {};
    if (this.db) {
      const [row] = await this.db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, SETTINGS_KEY));
      if (row && typeof row.value === 'object' && row.value) {
        this.cache = { ...(row.value as Record<string, string>) };
      }
    }
    return this.cache;
  }

  private async remember(key: string, fileId: string) {
    const cache = await this.load();
    cache[key] = fileId;
    if (this.db) {
      await this.db
        .insert(schema.appSettings)
        .values({ key: SETTINGS_KEY, value: cache, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: cache, updatedAt: new Date() },
        });
    }
  }

  async send(
    telegram: TelegramClient,
    chatId: ChatId,
    image: BotImage,
    caption: string,
    options: SendOptions,
  ): Promise<TelegramMessage> {
    const { bytes, hash } = await this.file(image);
    const key = `${image}:${hash}`;
    const known = (await this.load())[key];
    if (known) {
      try {
        return await telegram.sendPhoto(chatId, { fileId: known }, caption, options);
      } catch (error) {
        // A file_id from another bot token is rejected — upload afresh.
        if ((error as { kind?: string }).kind !== 'rejected') throw error;
      }
    }
    const sent = await telegram.sendPhoto(
      chatId,
      { bytes, filename: BOT_IMAGES[image] },
      caption,
      options,
    );
    const fileId = largestPhotoId(sent);
    if (fileId) await this.remember(key, fileId);
    return sent;
  }
}
