/**
 * A small Telegram Bot API client (https://core.telegram.org/bots/api) on
 * plain `fetch`: only the methods the worker uses, with errors that say
 * what kind of failure happened — so callers can wait out a 429, stop
 * writing to someone who blocked the bot, or retry a network error.
 *
 * The token appears only inside the request URL built here. It is never
 * part of an error message, a log line or anything returned.
 */

export type ChatId = number;

export interface InlineButton {
  text: string;
  url?: string;
  web_app?: { url: string };
  callback_data?: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  language_code?: string;
}
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}
export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  photo?: { file_id: string; width: number; height: number }[];
}
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/** A local file to upload, or a `file_id` Telegram already has. */
export type PhotoInput = { fileId: string } | { bytes: Uint8Array; filename: string };

export interface SendOptions {
  parseMode?: 'HTML';
  replyMarkup?: InlineKeyboard;
  disablePreview?: boolean;
}

export type TelegramFailure =
  /** 429 — wait `retryAfter` seconds before the next call. */
  | 'rate_limited'
  /** The user blocked the bot, deleted the account, or the chat is gone. */
  | 'unreachable'
  /** 401/404 — the token is wrong (never retried). */
  | 'unauthorized'
  /** 409 — another getUpdates reader or a webhook owns the updates. */
  | 'conflict'
  /** Anything else Telegram rejected (bad markup, too long…). */
  | 'rejected'
  /** Timeout, DNS, connection reset, 5xx — worth retrying later. */
  | 'network';

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly kind: TelegramFailure,
    readonly status: number | null,
    /** Telegram's own description (never contains the token). */
    readonly description: string,
    readonly retryAfter: number | null = null,
  ) {
    super(`Telegram ${method} failed (${kind}${status ? ` ${status}` : ''}): ${description}`);
    this.name = 'TelegramApiError';
  }
}

const UNREACHABLE =
  /blocked by the user|user is deactivated|chat not found|bot was kicked|PEER_ID_INVALID|have no rights to send/i;

function classify(status: number, description: string): TelegramFailure {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 404) return 'unauthorized';
  if (status === 409) return 'conflict';
  if (status === 403 || (status === 400 && UNREACHABLE.test(description))) return 'unreachable';
  if (status >= 500) return 'network';
  return 'rejected';
}

export interface TelegramClientOptions {
  token: string;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
  apiBase?: string;
}

/** getWebhookInfo — read-only. `url` may carry a secret path: never print it whole. */
export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
}

export interface TelegramClient {
  getMe(): Promise<TelegramUser & { username?: string }>;
  getWebhookInfo(): Promise<WebhookInfo>;
  getUpdates(
    params: { offset?: number; timeout: number; allowed_updates?: string[] },
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  sendMessage(chatId: ChatId, text: string, options?: SendOptions): Promise<TelegramMessage>;
  /** Returns the sent message; its largest `photo` size carries the reusable file_id. */
  sendPhoto(
    chatId: ChatId,
    photo: PhotoInput,
    caption?: string,
    options?: SendOptions,
  ): Promise<TelegramMessage>;
  sendMediaGroup(
    chatId: ChatId,
    photos: { photo: PhotoInput; caption?: string; parseMode?: 'HTML' }[],
  ): Promise<TelegramMessage[]>;
  answerCallbackQuery(id: string, text?: string): Promise<true>;
}

export function largestPhotoId(message: TelegramMessage): string | null {
  const sizes = message.photo ?? [];
  return sizes.length ? sizes[sizes.length - 1]!.file_id : null;
}

export function createTelegramClient({
  token,
  timeoutMs = 10_000,
  fetch: fetchImpl = fetch,
  apiBase = 'https://api.telegram.org',
}: TelegramClientOptions): TelegramClient {
  async function call<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
        method: 'POST',
        ...(body instanceof FormData
          ? { body }
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const name = (error as { name?: string } | null)?.name;
      throw new TelegramApiError(
        method,
        'network',
        null,
        name === 'TimeoutError' ? 'timeout' : 'network error',
      );
    }
    let payload: {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new TelegramApiError(
        method,
        classify(response.status || 502, ''),
        response.status,
        'invalid response',
      );
    }
    if (!response.ok || !payload.ok) {
      const description = String(payload.description ?? response.statusText ?? 'error').slice(
        0,
        300,
      );
      const status = response.ok ? 400 : response.status;
      throw new TelegramApiError(
        method,
        classify(status, description),
        status,
        description,
        payload.parameters?.retry_after ?? null,
      );
    }
    return payload.result as T;
  }

  const markup = (o?: SendOptions) => ({
    ...(o?.parseMode ? { parse_mode: o.parseMode } : {}),
    ...(o?.replyMarkup ? { reply_markup: o.replyMarkup } : {}),
  });

  return {
    getMe: () => call('getMe', {}),
    getWebhookInfo: () => call('getWebhookInfo', {}),
    getUpdates: (params, signal) =>
      call('getUpdates', params, { signal, timeoutMs: (params.timeout + 10) * 1000 }),
    sendMessage: (chatId, text, options) =>
      call('sendMessage', {
        chat_id: chatId,
        text,
        ...markup(options),
        ...(options?.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
      }),
    sendPhoto: (chatId, photo, caption, options) => {
      if ('fileId' in photo) {
        return call('sendPhoto', {
          chat_id: chatId,
          photo: photo.fileId,
          ...(caption ? { caption } : {}),
          ...markup(options),
        });
      }
      const form = new FormData();
      form.set('chat_id', String(chatId));
      form.set('photo', new Blob([photo.bytes]), photo.filename);
      if (caption) form.set('caption', caption);
      if (options?.parseMode) form.set('parse_mode', options.parseMode);
      if (options?.replyMarkup) form.set('reply_markup', JSON.stringify(options.replyMarkup));
      return call('sendPhoto', form, { timeoutMs: Math.max(timeoutMs, 30_000) });
    },
    sendMediaGroup: (chatId, photos) => {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      const media = photos.map((p, i) => {
        let ref: string;
        if ('fileId' in p.photo) {
          ref = p.photo.fileId;
        } else {
          ref = `attach://photo${i}`;
          form.set(`photo${i}`, new Blob([p.photo.bytes]), p.photo.filename);
        }
        return {
          type: 'photo',
          media: ref,
          ...(p.caption ? { caption: p.caption } : {}),
          ...(p.parseMode ? { parse_mode: p.parseMode } : {}),
        };
      });
      form.set('media', JSON.stringify(media));
      return call('sendMediaGroup', form, { timeoutMs: Math.max(timeoutMs, 60_000) });
    },
    answerCallbackQuery: (id, text) =>
      call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }),
  };
}
