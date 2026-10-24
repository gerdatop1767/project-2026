import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelegramClient, networkCause, TelegramApiError } from './client.js';

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

  it('a 5xx is a network failure that may have been acted on', async () => {
    const client = createTelegramClient({
      token: TOKEN,
      fetch: respond(502, { ok: false, description: 'Bad Gateway' }),
    });
    const error = (await client.sendMessage(1, 'x').catch((e: unknown) => e)) as TelegramApiError;
    expect(error.network).toEqual({ code: 'HTTP_502', timeout: false, maybeDelivered: true });
  });
});

/**
 * Real fetch against local sockets that misbehave the way a network can —
 * the error shapes are Node's own, not hand-made ones.
 */
describe('Telegram client: real network failures', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });
  const serve = (onRequest: (socket: Socket) => void) =>
    new Promise<string>((resolve) => {
      const server = createServer((socket) => socket.once('data', () => onRequest(socket)));
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  const freePort = () =>
    new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });
  const failure = async (apiBase: string, timeoutMs = 2_000) => {
    const client = createTelegramClient({ token: TOKEN, apiBase, timeoutMs });
    const error = await client.sendMessage(1, 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramApiError);
    const e = error as TelegramApiError;
    expect(e.kind).toBe('network');
    expect(`${e.message} ${JSON.stringify(e)}`).not.toContain('SECRET');
    return e;
  };

  it('connection refused: nothing was sent, safe to retry', async () => {
    const e = await failure(`http://127.0.0.1:${await freePort()}`);
    expect(e.network).toEqual({ code: 'ECONNREFUSED', timeout: false, maybeDelivered: false });
    expect(e.description).toBe('network error (ECONNREFUSED)');
  });

  it('the server drops the connection after reading the request: may have been delivered', async () => {
    const e = await failure(await serve((socket) => socket.destroy()));
    expect(e.network).toEqual({ code: 'UND_ERR_SOCKET', timeout: false, maybeDelivered: true });
  });

  it('a reset after the request: may have been delivered', async () => {
    const e = await failure(await serve((socket) => socket.resetAndDestroy()));
    expect(e.network).toEqual({ code: 'ECONNRESET', timeout: false, maybeDelivered: true });
  });

  it('no answer in time: a timeout that may have been delivered', async () => {
    const e = await failure(await serve(() => undefined), 300);
    expect(e.network).toEqual({ code: null, timeout: true, maybeDelivered: true });
    expect(e.description).toBe('timeout');
  });

  it('a 200 whose body breaks off is not «rejected»: Telegram already did it', async () => {
    const e = await failure(
      await serve((socket) => {
        socket.write(
          'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 80\r\n\r\n{"ok":',
        );
        setTimeout(() => socket.destroy(), 20);
      }),
    );
    expect(e.status).toBe(200);
    expect(e.network).toMatchObject({ code: 'UND_ERR_SOCKET', maybeDelivered: true });
  });
});

describe('networkCause', () => {
  const fetchFailed = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause });

  it('a connect that never completes (undici connect timeout) was not sent', () => {
    const cause = Object.assign(new Error('Connect Timeout Error'), {
      name: 'ConnectTimeoutError',
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    expect(networkCause(fetchFailed(cause))).toEqual({
      code: 'UND_ERR_CONNECT_TIMEOUT',
      timeout: false,
      maybeDelivered: false,
    });
  });

  it('DNS failures were not sent', () => {
    const cause = Object.assign(new Error('getaddrinfo EAI_AGAIN api.telegram.org'), {
      code: 'EAI_AGAIN',
      syscall: 'getaddrinfo',
    });
    expect(networkCause(fetchFailed(cause))).toMatchObject({
      code: 'EAI_AGAIN',
      maybeDelivered: false,
    });
  });

  it('IPv6 and IPv4 attempts that all failed to connect were not sent', () => {
    const cause = Object.assign(
      new AggregateError([
        Object.assign(new Error('connect ENETUNREACH'), {
          code: 'ENETUNREACH',
          syscall: 'connect',
        }),
        Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'connect' }),
      ]),
      { code: 'ETIMEDOUT' },
    );
    expect(networkCause(fetchFailed(cause))).toEqual({
      code: 'ETIMEDOUT',
      timeout: false,
      maybeDelivered: false,
    });
  });

  it('never keeps free text as a code', () => {
    const cause = { code: `https://api.telegram.org/bot${TOKEN}/x` };
    expect(networkCause(fetchFailed(cause)).code).toBeNull();
  });
});
