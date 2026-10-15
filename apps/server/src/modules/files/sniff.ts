export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export const IMAGE_TYPES: readonly ImageType[] = ['image/png', 'image/jpeg', 'image/webp'];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** The real image type from the first bytes, or null when it is not a PNG, JPEG or WebP. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buf.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg';
  // WebP: "RIFF", a 4-byte size, then "WEBP".
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
