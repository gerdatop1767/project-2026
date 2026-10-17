import { createHmac } from 'node:crypto';

/**
 * Test-only helpers. The Telegram signer below is written independently of
 * `verifyTelegramInitData` (straight from the algorithm in Telegram's docs),
 * so a test that passes proves the server's check agrees with the spec and
 * not merely with itself.
 */
export function signTelegramInitData(
  botToken: string,
  fields: Record<string, string>,
  overrides: { hash?: string } = {},
): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', overrides.hash ?? hash);
  return params.toString();
}

export interface TgUserInput {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  is_bot?: boolean;
}

export function telegramLaunch(
  botToken: string,
  user: TgUserInput,
  options: { authDate?: number; extra?: Record<string, string> } = {},
): string {
  return signTelegramInitData(botToken, {
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    signature: 'unused-third-party-signature',
    user: JSON.stringify(user),
    ...options.extra,
  });
}

/** Minimal byte sequences whose headers describe an image of the given size. */
export function fakePng(width: number, height: number, extra = 0): Buffer {
  const buf = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

export function fakeJpeg(width: number, height: number): Buffer {
  // SOI, APP0 (JFIF, 16 bytes), SOF0 frame header, EOI.
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

export function fakeWebpLossy(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(32, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8 ', 12, 'latin1');
  buf.writeUInt32LE(20, 16);
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  buf.writeUInt16LE(width, 26);
  buf.writeUInt16LE(height, 28);
  return buf;
}

export function cookieValue(header: string | string[] | undefined, name: string) {
  const headers = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of headers) {
    const [pair] = raw.split(';');
    const index = pair!.indexOf('=');
    if (pair!.slice(0, index) === name) return pair!.slice(index + 1);
  }
  return undefined;
}
