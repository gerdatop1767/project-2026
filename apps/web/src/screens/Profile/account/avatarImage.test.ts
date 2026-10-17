import { describe, expect, it } from 'vitest';
import {
  AVATAR_SOURCE_MAX_BYTES,
  checkAvatarFile,
  prepareAvatar,
  AvatarFileError,
} from './avatarImage.js';

const file = (type: string, size = 100) => new File([new Uint8Array(size)], 'photo', { type });

describe('checkAvatarFile (pre-upload sanity; the server re-checks the real bytes)', () => {
  it('accepts JPEG, PNG and WebP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(checkAvatarFile(file(type))).toBeNull();
    }
  });
  it('refuses SVG, GIF, HEIC and non-images', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'image/heic', 'text/html', '']) {
      expect(checkAvatarFile(file(type))).toBe('unsupported_type');
    }
  });
  it('refuses huge files before decoding', () => {
    expect(checkAvatarFile(file('image/jpeg', AVATAR_SOURCE_MAX_BYTES + 1))).toBe('too_big');
  });
  it('prepareAvatar rejects an unsupported file with a typed error', async () => {
    await expect(prepareAvatar(file('image/gif'))).rejects.toBeInstanceOf(AvatarFileError);
    await expect(prepareAvatar(file('image/gif'))).rejects.toMatchObject({
      problem: 'unsupported_type',
    });
  });
});
