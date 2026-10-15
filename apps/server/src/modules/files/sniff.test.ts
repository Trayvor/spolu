import { describe, expect, it } from 'vitest';
import { sniffImageType } from './sniff.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 '),
]);

describe('sniffImageType', () => {
  it('recognises PNG, JPEG and WebP by magic bytes', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('rejects a PDF, a WAV (RIFF but not WEBP), a truncated header and empty input', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.7 hello'))).toBeNull();
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from('WAVEfmt '),
    ]);
    expect(sniffImageType(wav)).toBeNull();
    expect(sniffImageType(png.subarray(0, 5))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
