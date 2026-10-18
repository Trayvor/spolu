import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jpegWith, pngWith, webpWith } from '../../../test/logo-images.js';
import { stripImageMetadata } from './logo-metadata.js';

const SECRET = 'GPS 48.1486N 17.1077E Jana Nova';

describe('stripImageMetadata', () => {
  it('drops the text, EXIF and time chunks of a PNG and keeps the image', () => {
    const out = stripImageMetadata(pngWith(SECRET), 'image/png')!;
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(out.toString('latin1')).not.toContain('tIME');
    expect(out.equals(pngWith())).toBe(true);
  });

  it('keeps a PNG without metadata byte for byte, the real e2e fixture too', () => {
    expect(stripImageMetadata(pngWith(), 'image/png')!.equals(pngWith())).toBe(true);
    const real = readFileSync(new URL('../../../../../e2e/fixtures/logo.png', import.meta.url));
    const out = stripImageMetadata(real, 'image/png')!;
    expect(out.subarray(0, 8).equals(real.subarray(0, 8))).toBe(true);
    expect(out.subarray(-12).equals(real.subarray(-12))).toBe(true);
  });

  it('drops the EXIF, XMP, IPTC and comment segments of a JPEG and keeps the scan', () => {
    const out = stripImageMetadata(jpegWith(SECRET), 'image/jpeg')!;
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(out.equals(jpegWith())).toBe(true);
  });

  it('drops the EXIF and XMP chunks of a WebP and clears their flags', () => {
    const out = stripImageMetadata(webpWith(SECRET), 'image/webp')!;
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(out.equals(webpWith())).toBe(true);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
  });

  it('drops bytes after the end of the image', () => {
    const tail = Buffer.from('<script>alert(1)</script>');
    for (const [image, type] of [
      [pngWith(), 'image/png'],
      [jpegWith(), 'image/jpeg'],
      [webpWith(), 'image/webp'],
    ] as const) {
      const out = stripImageMetadata(Buffer.concat([image, tail]), type)!;
      expect(out.equals(image)).toBe(true);
    }
  });

  it('refuses a broken file: null', () => {
    const png = pngWith();
    expect(stripImageMetadata(png.subarray(0, 30), 'image/png')).toBeNull();
    expect(stripImageMetadata(Buffer.concat([png.subarray(0, 8), Buffer.from('x')]), 'image/png')).toBeNull();
    const jpeg = jpegWith();
    expect(stripImageMetadata(jpeg.subarray(0, 10), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(webpWith().subarray(0, 20), 'image/webp')).toBeNull();
  });
});
