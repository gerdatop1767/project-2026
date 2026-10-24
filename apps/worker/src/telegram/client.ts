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
/** The keyboard under the input field (sends its button's text as a message). */
export interface ReplyKeyboard {
  keyboard: { text: string }[][];
  /** Stays shown even after the user hides the system keyboard. */
  is_persistent?: boolean;
  /** Compact buttons instead of half the screen on phones. */
  resize_keyboard?: boolean;
  input_field_placeholder?: string;
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
  /** Text under a photo or a file. */
  caption?: string;
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  /** Kinds support does not take (only their presence matters). */
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
  video_note?: unknown;
  sticker?: unknown;
  animation?: unknown;
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
  replyMarkup?: InlineKeyboard | ReplyKeyboard;
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

/**
 * What is known about a `network` failure — safe to log and store: an
 * error code (never a message or URL, which could carry the token) and
 * whether Telegram may already have acted on the request.
 */
export interface NetworkCause {
  /** errno / undici code (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT…),
   * `HTTP_502` for a 5xx answer, or null when there is none (our timeout). */
  code: string | null;
  /** Our own request timeout fired. */
  timeout: boolean;
  /**
   * False only when the request provably never reached Telegram (DNS,
   * refused / unreachable / timed-out connect, certificate) — then it is
   * safe to send again. True when the connection broke or timed out after
   * the request may have been delivered: sending again could duplicate it.
   */
  maybeDelivered: boolean;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly kind: TelegramFailure,
    readonly status: number | null,
    /** Telegram's own description (never contains the token). */
    readonly description: string,
    readonly retryAfter: number | null = null,
    /** Set for `network` failures. */
    readonly network: NetworkCause | null = null,
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

/** Failures that happen before a request is sent: nothing reached Telegram. */
const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const CERTIFICATE_CODE = /^(CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|ERR_TLS_CERT)/;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  syscall?: unknown;
  errors?: unknown;
  cause?: unknown;
}

/** Only codes made of A–Z, 0–9 and `_` are kept: never free text. */
function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z0-9_]{2,40}$/.test(value) ? value : null;
}

function connectFailure(e: ErrorLike): boolean {
  const code = safeCode(e.code);
  return (
    (code !== null && (NOT_SENT_CODES.has(code) || CERTIFICATE_CODE.test(code))) ||
    e.syscall === 'connect' ||
    e.syscall === 'getaddrinfo'
  );
}

/**
 * fetch() rejects with TypeError('fetch failed') and the real reason in
 * `cause` (undici / errno). Several connect attempts (IPv6 and IPv4 tried
 * in turn) fail as an AggregateError with one error per address.
 */
export function networkCause(error: unknown): NetworkCause {
  const outer = (error ?? {}) as ErrorLike;
  if (outer.name === 'TimeoutError') return { code: null, timeout: true, maybeDelivered: true };
  const cause = (outer.cause ?? outer) as ErrorLike;
  const attempts = Array.isArray(cause.errors) ? (cause.errors as ErrorLike[]) : null;
  if (attempts && attempts.length > 0) {
    return {
      code: safeCode(cause.code) ?? safeCode(attempts[0]!.code),
      timeout: false,
      maybeDelivered: !attempts.every(connectFailure),
    };
  }
  return {
    code: safeCode(cause.code) ?? (cause === outer ? null : safeCode(cause.name)),
    timeout: false,
    maybeDelivered: !connectFailure(cause),
  };
}

function networkError(method: string, network: NetworkCause, status: number | null = null) {
  const description = network.timeout
    ? 'timeout'
    : `network error${network.code ? ` (${network.code})` : ''}`;
  return new TelegramApiError(method, 'network', status, description, null, network);
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

/**
 * Longer than undici's own 10 s connect timeout on purpose: a connection
 * that never opens then fails as UND_ERR_CONNECT_TIMEOUT — known not sent,
 * safe to retry — instead of an ambiguous timeout of the whole request.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export function createTelegramClient({
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
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
      throw networkError(method, networkCause(error));
    }
    let payload: {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // The answer broke off (or timed out) after its status line: with a
      // 2xx Telegram has already done what was asked.
      if (response.ok || response.status >= 500) {
        const cause = networkCause(error);
        throw networkError(method, { ...cause, maybeDelivered: true }, response.status);
      }
      throw new TelegramApiError(
        method,
        classify(response.status, ''),
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
      const kind = classify(status, description);
      throw new TelegramApiError(
        method,
        kind,
        status,
        description,
        payload.parameters?.retry_after ?? null,
        // A 5xx gives no promise either way about what Telegram did.
        kind === 'network'
          ? { code: `HTTP_${status}`, timeout: false, maybeDelivered: true }
          : null,
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
