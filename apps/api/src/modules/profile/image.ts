import { AVATAR_MAX_SIDE, AVATAR_MIN_SIDE, type AvatarContentType } from '@zybrilka/shared';

export type ImageProblem = 'unsupported_type' | 'corrupt' | 'bad_dimensions';

export interface InspectedImage {
  contentType: AvatarContentType;
  width: number;
  height: number;
}

/**
 * Decides what an uploaded file REALLY is by reading its bytes — the
 * `Content-Type` header and file name come from the client and prove
 * nothing. Recognizes only JPEG, PNG and WebP (never SVG, GIF or anything
 * that can carry script/markup) and reads the pixel size from the format's
 * own header, rejecting absurd or tiny dimensions.
 *
 * Deliberately does not decode pixels (no image library in the stack): a
 * file with a valid header but broken body is stored as-is and simply
 * fails to render, which the UI treats as "no avatar". It is only ever
 * served back with `nosniff` + a sandbox CSP and to its owner, so the
 * worst case is a broken picture.
 */
export function inspectImage(buf: Buffer): InspectedImage | { problem: ImageProblem } {
  const image = readImageHeader(buf);
  if ('problem' in image) return image;
  const { width, height } = image;
  const ok = (side: number) => side >= AVATAR_MIN_SIDE && side <= AVATAR_MAX_SIDE;
  if (!ok(width) || !ok(height)) return { problem: 'bad_dimensions' };
  return image;
}

/** The real type and pixel size from the file's own header, with no size
 * policy — callers apply their own limits (avatars above, broadcasts). */
export function readImageHeader(
  buf: Buffer,
): InspectedImage | { problem: 'unsupported_type' | 'corrupt' } {
  const detected = detect(buf);
  if (!detected) return { problem: 'unsupported_type' };
  const size = detected.read(buf);
  if (!size) return { problem: 'corrupt' };
  return { contentType: detected.contentType, width: size.width, height: size.height };
}

interface Detected {
  contentType: AvatarContentType;
  read: (buf: Buffer) => { width: number; height: number } | null;
}

function detect(buf: Buffer): Detected | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: 'image/jpeg', read: readJpeg };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: 'image/png', read: readPng };
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { contentType: 'image/webp', read: readWebp };
  }
  return null;
}

function readPng(buf: Buffer) {
  // 8-byte signature, then the IHDR chunk: length(4)=13, "IHDR", width(4), height(4).
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpeg(buf: Buffer) {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    let marker = buf[offset + 1]!;
    while (marker === 0xff && offset + 2 < buf.length) {
      offset += 1; // fill bytes
      marker = buf[offset + 1]!;
    }
    // Standalone markers have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any frame header
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebp(buf: Buffer) {
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag, start code 9D 01 2A, then 14-bit width / height.
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2F, then 14-bit (width-1) and 14-bit (height-1).
    if (buf.length < 25 || buf[20] !== 0x2f) return null;
    const b1 = buf[21]!;
    const b2 = buf[22]!;
    const b3 = buf[23]!;
    const b4 = buf[24]!;
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit little-endian (canvas width-1) and (canvas height-1).
    if (buf.length < 30) return null;
    return {
      width: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)),
      height: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)),
    };
  }
  return null;
}
