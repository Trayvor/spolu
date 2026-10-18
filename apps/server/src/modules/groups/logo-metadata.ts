import type { ImageType } from '../files/sniff.js';

/**
 * Removes the metadata of a logo received from an integration (the eGrant groups webhook)
 * without decoding the image, so no image library is needed: EXIF (with GPS and camera data),
 * XMP, IPTC, text chunks, comments and anything after the end of the image. The pixels and the
 * colour profile stay. Null when the file's structure is broken, so a damaged or disguised file
 * is refused instead of stored.
 */
export function stripImageMetadata(bytes: Buffer, type: ImageType): Buffer | null {
  try {
    if (type === 'image/png') return stripPng(bytes);
    if (type === 'image/jpeg') return stripJpeg(bytes);
    return stripWebp(bytes);
  } catch {
    // A length that runs past the end of the buffer.
    return null;
  }
}

/**
 * The pixel size an image declares in its header (PNG IHDR, JPEG SOFn, WebP VP8X, VP8 or VP8L),
 * read without decoding anything, so a huge image can be refused before any browser decodes it.
 * Null when the header is missing or cut.
 */
export function imageSize(
  bytes: Buffer,
  type: ImageType,
): { width: number; height: number } | null {
  try {
    if (type === 'image/png') return pngSize(bytes);
    if (type === 'image/jpeg') return jpegSize(bytes);
    return webpSize(bytes);
  } catch {
    // A read past the end of the buffer.
    return null;
  }
}

function pngSize(bytes: Buffer) {
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
const isSof = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(bytes: Buffer) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let markerAt = at + 1;
    while (bytes[markerAt] === 0xff) markerAt++;
    const marker = bytes[markerAt];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    if (standalone(marker)) {
      at = markerAt + 1;
      continue;
    }
    if (isSof(marker)) {
      return { height: bytes.readUInt16BE(markerAt + 4), width: bytes.readUInt16BE(markerAt + 6) };
    }
    at = markerAt + 1 + bytes.readUInt16BE(markerAt + 1);
  }
  return null;
}

function webpSize(bytes: Buffer) {
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const type = bytes.toString('latin1', 12, 16);
  const data = 20;
  if (type === 'VP8X') {
    return { width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1 };
  }
  if (type === 'VP8 ') {
    return {
      width: bytes.readUInt16LE(data + 6) & 0x3fff,
      height: bytes.readUInt16LE(data + 8) & 0x3fff,
    };
  }
  if (type === 'VP8L') {
    const bits = bytes.readUInt32LE(data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** PNG chunks that carry text, EXIF or a timestamp. */
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(bytes: Buffer): Buffer | null {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let at = 8;
  let first = true;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (!PNG_DROP.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') return Buffer.concat(kept);
  }
  return null;
}

/** Markers without a length: TEM and RST0–RST7. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
/** APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform) stay. */
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee]);
const isDropped = (marker: number) =>
  marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !JPEG_KEEP_APP.has(marker));

function stripJpeg(bytes: Buffer): Buffer | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let markerAt = at + 1;
    while (bytes[markerAt] === 0xff) markerAt++; // fill bytes
    const marker = bytes[markerAt];
    if (marker === undefined) return null;
    if (standalone(marker)) {
      kept.push(Buffer.from([0xff, marker]));
      at = markerAt + 1;
      continue;
    }
    if (marker === 0xd9) return null; // the end before any scan
    const length = bytes.readUInt16BE(markerAt + 1);
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xda) {
      // Start of scan: the rest is image data (and further scans) up to the last EOI.
      const eoi = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi < end) return null;
      kept.push(Buffer.from([0xff, marker]), bytes.subarray(markerAt + 1, eoi + 2));
      return Buffer.concat(kept);
    }
    if (!isDropped(marker))
      kept.push(Buffer.from([0xff, marker]), bytes.subarray(markerAt + 1, end));
    at = end;
  }
  return null;
}

/** VP8X flag bits of the dropped chunks. */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(bytes: Buffer): Buffer | null {
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const riffEnd = 8 + bytes.readUInt32LE(4);
  if (riffEnd > bytes.length) return null;
  const kept: Buffer[] = [];
  let at = 12;
  let image = false;
  while (at + 8 <= riffEnd) {
    const type = bytes.toString('latin1', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const end = Math.min(at + 8 + size + (size % 2), riffEnd);
    if (at + 8 + size > riffEnd) return null;
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANIM') image = true;
    if (type === 'VP8X') {
      const chunk = Buffer.from(bytes.subarray(at, end));
      chunk[8] = chunk[8]! & ~(VP8X_EXIF | VP8X_XMP);
      kept.push(chunk);
    } else if (type !== 'EXIF' && type !== 'XMP ') {
      kept.push(bytes.subarray(at, end));
    }
    at = end;
  }
  if (!image || at !== riffEnd) return null;
  const body = Buffer.concat([Buffer.from('WEBP'), ...kept]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
