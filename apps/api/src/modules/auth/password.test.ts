import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

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
