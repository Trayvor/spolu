import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jpegWith, pngWith, webpWith } from '../../../test/logo-images.js';
import { imageSize, stripImageMetadata } from './logo-metadata.js';

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
    expect(
      stripImageMetadata(Buffer.concat([png.subarray(0, 8), Buffer.from('x')]), 'image/png'),
    ).toBeNull();
    const jpeg = jpegWith();
    expect(stripImageMetadata(jpeg.subarray(0, 10), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(webpWith().subarray(0, 20), 'image/webp')).toBeNull();
  });
});

describe('imageSize (read from the header, nothing decoded)', () => {
  const big = { width: 20000, height: 300 };

  it('reads a PNG IHDR, a JPEG SOF after other segments and a WebP VP8X canvas', () => {
    expect(imageSize(pngWith(), 'image/png')).toEqual({ width: 1, height: 1 });
    expect(imageSize(pngWith(SECRET, big), 'image/png')).toEqual(big);
    expect(imageSize(jpegWith(SECRET, big), 'image/jpeg')).toEqual(big);
    expect(imageSize(webpWith(SECRET, big), 'image/webp')).toEqual(big);
  });

  it('reads a simple (VP8) and a lossless (VP8L) WebP', () => {
    const riff = (chunk: Buffer) => {
      const body = Buffer.concat([Buffer.from('WEBP'), chunk]);
      const head = Buffer.from('RIFF\0\0\0\0', 'latin1');
      head.writeUInt32LE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    const vp8 = Buffer.from('VP8 \x0a\0\0\0\x30\x01\x00\x9d\x01\x2a\0\0\0\0', 'latin1');
    vp8.writeUInt16LE(5000, 14);
    vp8.writeUInt16LE(16383, 16);
    expect(imageSize(riff(vp8), 'image/webp')).toEqual({ width: 5000, height: 16383 });
    const vp8l = Buffer.from('VP8L\x05\0\0\0\x2f\0\0\0\0\0', 'latin1');
    // 14 bits of width - 1, then 14 bits of height - 1, least significant bit first.
    vp8l.writeUInt32LE((4999 | (299 << 14)) >>> 0, 9);
    expect(imageSize(riff(vp8l), 'image/webp')).toEqual({ width: 5000, height: 300 });
  });

  it('null when the header is missing or cut', () => {
    expect(imageSize(pngWith().subarray(0, 20), 'image/png')).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
    expect(imageSize(webpWith().subarray(0, 16), 'image/webp')).toBeNull();
  });
});
