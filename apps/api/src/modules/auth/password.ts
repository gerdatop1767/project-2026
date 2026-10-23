import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing (docs/EMAIL_AUTH.md): scrypt from Node's own crypto —
 * a memory-hard KDF, no native add-on to build. Parameters follow one of
 * OWASP's recommended scrypt settings (N=2^15, r=8, p=3 ≈ 32 MiB, ~0.2 s
 * here). Stored as `scrypt$<log2 N>$<r>$<p>$<salt>$<hash>` (base64url), so
 * stronger parameters can be introduced later and old hashes still verify.
 */
const LOG2_N = 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  params: { log2N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: 2 ** params.log2N, r: params.r, p: params.p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { log2N: LOG2_N, r: R, p: P });
  return ['scrypt', LOG2_N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Constant-time check. A malformed stored value never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const params = { log2N: Number(n), r: Number(r), p: Number(p) };
  if (
    !Number.isInteger(params.log2N) ||
    params.log2N < 10 ||
    params.log2N > 20 ||
    !Number.isInteger(params.r) ||
    params.r < 1 ||
    params.r > 32 ||
    !Number.isInteger(params.p) ||
    params.p < 1 ||
    params.p > 16
  ) {
    return false;
  }
  const expected = Buffer.from(hashText!, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const key = await derive(password, Buffer.from(saltText!, 'base64url'), params);
  return timingSafeEqual(key, expected);
}

/** A real hash of a random value: verifying against it costs the same as a
 * real check, so "no such account" and "wrong password" take equally long. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
