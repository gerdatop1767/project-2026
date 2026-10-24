import { describe, expect, it } from 'vitest';
import { fakeJpeg, fakePng, fakeWebpLossy } from '../../testSupport.js';
import { inspectImage } from './image.js';

describe('inspectImage (decides by bytes, never by what the client claims)', () => {
  it('recognizes PNG, JPEG and WebP and reads their real dimensions', () => {
    expect(inspectImage(fakePng(300, 200))).toEqual({
      contentType: 'image/png',
      width: 300,
      height: 200,
    });
    expect(inspectImage(fakeJpeg(640, 480))).toEqual({
      contentType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    expect(inspectImage(fakeWebpLossy(512, 512))).toEqual({
      contentType: 'image/webp',
      width: 512,
      height: 512,
    });
  });

  it.each([
    [
      'SVG with a script',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ],
    ['HTML', Buffer.from('<html><body onload=alert(1)></body></html>')],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
    ['plain text', Buffer.from('hello world')],
    ['an executable', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])],
    ['an empty file', Buffer.alloc(0)],
  ])('refuses %s, whatever its name or Content-Type said', (_name, bytes) => {
    expect(inspectImage(bytes)).toEqual({ problem: 'unsupported_type' });
  });

  it('refuses a truncated header as corrupt', () => {
    expect(inspectImage(fakePng(300, 200).subarray(0, 14))).toEqual({ problem: 'corrupt' });
    expect(inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ problem: 'corrupt' });
  });

  it('refuses images that are too small or absurdly large', () => {
    expect(inspectImage(fakePng(10, 10))).toEqual({ problem: 'bad_dimensions' });
    expect(inspectImage(fakePng(100_000, 100_000))).toEqual({ problem: 'bad_dimensions' });
    expect(inspectImage(fakePng(5000, 100))).toEqual({ problem: 'bad_dimensions' });
  });
});
