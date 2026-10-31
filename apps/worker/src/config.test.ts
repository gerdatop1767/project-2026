import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const polling = (value: string | undefined) =>
  loadConfig({ TELEGRAM_BOT_POLLING: value } as NodeJS.ProcessEnv).TELEGRAM_BOT_POLLING;

describe('TELEGRAM_BOT_POLLING', () => {
  it('is off unless asked for', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).TELEGRAM_BOT_POLLING).toBe(false);
    for (const off of [undefined, '', '  ', 'false', 'FALSE', 'False', '0']) {
      expect(polling(off), String(off)).toBe(false);
    }
  });

  it('accepts true and 1 in any case', () => {
    for (const on of ['true', 'TRUE', 'True', ' true ', '1']) {
      expect(polling(on), on).toBe(true);
    }
  });

  it('refuses anything else with a clear message', () => {
    for (const bad of ['yes', 'on', '2', 'tru']) {
      let message = '';
      try {
        polling(bad);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).toContain('TELEGRAM_BOT_POLLING');
      expect(message, bad).toContain('expected true, false, 1 or 0');
    }
  });
});
