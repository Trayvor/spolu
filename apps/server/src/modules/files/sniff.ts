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

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Office and OpenDocument files are ZIP archives; the extension tells which one. */
const ZIP_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};
/** Legacy Office files share the OLE container. */
const OLE_TYPES: Record<string, string> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};
const TEXT_TYPES: Record<string, string> = { txt: 'text/plain', csv: 'text/csv' };

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function isPlainText(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    strictUtf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The type of a file received whole from an integration (the ticket intake, Phase 21), when it
 * is one Spolu takes: images (PNG, JPEG, WebP, GIF) and PDF by their bytes alone; Office,
 * OpenDocument and ZIP files by their container bytes plus the extension; RTF; UTF-8 text named
 * `.txt` or `.csv`. Null for anything else (programs, scripts, HTML, SVG, unknown binaries).
 */
export function sniffAllowedType(bytes: Buffer, name: string): string | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  const head = bytes.toString('latin1', 0, 8);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('%PDF-')) return 'application/pdf';
  if (head.startsWith('{\\rtf')) return 'application/rtf';
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (bytes.subarray(0, 4).equals(ZIP_MAGIC)) return ZIP_TYPES[ext] ?? null;
  if (bytes.subarray(0, 8).equals(OLE_MAGIC)) return OLE_TYPES[ext] ?? null;
  const text = TEXT_TYPES[ext];
  return text && isPlainText(bytes) ? text : null;
}
