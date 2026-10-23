import { describe, expect, it, vi } from 'vitest';
import { createTelegramClient, TelegramApiError } from './client.js';

const TOKEN = '123456:SECRET-token_value';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('Telegram client', () => {
  it('calls the Bot API with JSON and returns the result', async () => {
    const fetch = respond(200, {
      ok: true,
      result: { message_id: 7, chat: { id: 1, type: 'private' } },
    });
    const client = createTelegramClient({ token: TOKEN, fetch });
    const sent = await client.sendMessage(1, 'Привет', { parseMode: 'HTML' });
    expect(sent.message_id).toBe(7);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: 1,
      text: 'Привет',
      parse_mode: 'HTML',
    });
  });

  it.each([
    [
      429,
      {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 7',
        parameters: { retry_after: 7 },
      },
      'rate_limited',
      7,
    ],
    [
      403,
      { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
      'unreachable',
      null,
    ],
    [
      400,
      { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
      'unreachable',
      null,
    ],
    [
      400,
      { ok: false, error_code: 400, description: "Bad Request: can't parse entities" },
      'rejected',
      null,
    ],
    [401, { ok: false, error_code: 401, description: 'Unauthorized' }, 'unauthorized', null],
    [
      409,
      {
        ok: false,
        error_code: 409,
        description: 'Conflict: terminated by other getUpdates request',
      },
      'conflict',
      null,
    ],
    [502, { ok: false, error_code: 502, description: 'Bad Gateway' }, 'network', null],
  ] as const)('HTTP %i is classified', async (status, body, kind, retryAfter) => {
    const client = createTelegramClient({ token: TOKEN, fetch: respond(status, body) });
    const error = await client.sendMessage(1, 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error).toMatchObject({ kind, status, retryAfter });
  });

  it('never puts the token into an error', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });
    const client = createTelegramClient({ token: TOKEN, fetch: failing });
    const error = (await client.sendMessage(1, 'x').catch((e: unknown) => e)) as TelegramApiError;
    expect(error.kind).toBe('network');
    expect(`${error.message} ${error.description} ${JSON.stringify(error)}`).not.toContain(
      'SECRET',
    );

    const rejected = createTelegramClient({
      token: TOKEN,
      fetch: respond(400, { ok: false, description: 'Bad Request: message is too long' }),
    });
    const e2 = (await rejected.sendMessage(1, 'x').catch((e: unknown) => e)) as TelegramApiError;
    expect(e2.message).not.toContain('SECRET');
  });

  it('uploads a local photo as multipart form data', async () => {
    const fetch = respond(200, {
      ok: true,
      result: {
        message_id: 1,
        chat: { id: 5, type: 'private' },
        photo: [{ file_id: 'small' }, { file_id: 'big' }],
      },
    });
    const client = createTelegramClient({ token: TOKEN, fetch });
    await client.sendPhoto(
      5,
      { bytes: new Uint8Array([1, 2, 3]), filename: 'welcome.png' },
      'Подпись',
      {
        parseMode: 'HTML',
        replyMarkup: { inline_keyboard: [[{ text: 'A', url: 'https://example.org' }]] },
      },
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('5');
    expect(form.get('caption')).toBe('Подпись');
    expect(form.get('parse_mode')).toBe('HTML');
    expect(JSON.parse(form.get('reply_markup') as string).inline_keyboard[0][0].url).toBe(
      'https://example.org',
    );
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });
});
