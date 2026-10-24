import { describe, expect, it } from 'vitest';
import { ApiError } from './api.js';
import { telegramErrorCode, telegramErrorMessage } from './telegramErrors.js';

describe('telegramErrorCode', () => {
  it("uses the server's own error code", () => {
    expect(telegramErrorCode(new ApiError(503, { error: 'telegram_not_configured' }))).toBe(
      'telegram_not_configured',
    );
    expect(telegramErrorCode(new ApiError(401, { error: 'invalid_telegram_data' }))).toBe(
      'invalid_telegram_data',
    );
  });
  it('names what the failure looked like when the body has no usable code', () => {
    expect(telegramErrorCode(new ApiError(429, { error: 'Too Many Requests' }))).toBe(
      'rate_limited',
    );
    expect(telegramErrorCode(new ApiError(502, undefined))).toBe('http_502');
    expect(telegramErrorCode(new ApiError(500, { error: '<script>' }))).toBe('http_500');
    expect(telegramErrorCode(new TypeError('Failed to fetch'))).toBe('network');
  });
});

describe('telegramErrorMessage', () => {
  it.each([
    ['telegram_not_configured', 'ещё не включён на сервере'],
    ['telegram_data_expired', 'устарели'],
    ['invalid_telegram_data', 'не подтвердил данные запуска'],
    ['rate_limited', 'Слишком много попыток'],
    ['network', 'Нет связи'],
    ['http_500', 'Не удалось войти через Telegram'],
  ])('%s is explained in its own words and keeps the code visible', (code, text) => {
    const message = telegramErrorMessage(code);
    expect(message).toContain(text);
    expect(message).toContain(`(код: ${code})`);
  });

  it('never offers the removed email sign-in', () => {
    const message = telegramErrorMessage('telegram_not_configured');
    expect(message).toContain('VK ID или Яндекс ID');
    expect(message).not.toMatch(/почт/);
  });
});
