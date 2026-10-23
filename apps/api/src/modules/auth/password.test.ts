import { describe, expect, it } from 'vitest';
import { passwordProblem } from '@zybrilka/shared';
import { hashPassword, verifyPassword } from './password.js';
import { EmailThrottle } from './emailThrottle.js';

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('Ege2026-strong');
    const b = await hashPassword('Ege2026-strong');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$15$8$3$')).toBe(true);
    expect(await verifyPassword('Ege2026-strong', a)).toBe(true);
    expect(await verifyPassword('ege2026-strong', a)).toBe(false);
  });

  it('never matches a malformed or tampered stored value', async () => {
    const good = await hashPassword('Ege2026-strong');
    expect(await verifyPassword('Ege2026-strong', 'plain-text')).toBe(false);
    expect(await verifyPassword('Ege2026-strong', good.replace('$15$', '$30$'))).toBe(false);
    expect(await verifyPassword('Ege2026-strong', `${good.slice(0, -4)}AAAA`)).toBe(false);
  });
});

describe('password rules', () => {
  it('explains what is wrong', () => {
    expect(passwordProblem('short1')).toBe('too_short');
    expect(passwordProblem('a'.repeat(129))).toBe('too_long');
    expect(passwordProblem('password')).toBe('too_simple');
    expect(passwordProblem('aaaaaaaaab')).toBe('too_simple');
    expect(passwordProblem('ivanov.petr', 'Ivanov.Petr@mail.ru')).toBe('too_simple');
    expect(passwordProblem('Ege2026-strong', 'a@b.ru')).toBeNull();
  });
});

describe('per-address letter limit', () => {
  it('one a minute, five an hour, and a failed send gives the slot back', () => {
    let now = 0;
    const t = new EmailThrottle(60_000, 5, () => now);
    expect(t.take('a')).toEqual({ ok: true });
    expect(t.take('a')).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(t.take('b')).toEqual({ ok: true });
    t.release('b');
    expect(t.take('b')).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) {
      now += 61_000;
      expect(t.take('a').ok).toBe(true);
    }
    now += 61_000;
    const blocked = t.take('a');
    expect(blocked.ok).toBe(false);
    now += 3_600_000;
    expect(t.take('a').ok).toBe(true);
  });
});
