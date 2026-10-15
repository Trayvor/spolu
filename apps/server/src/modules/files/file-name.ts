const MAX_NAME_LENGTH = 255;
// Separators, C0/C1 controls and Unicode bidi controls (they can disguise an extension).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[/\\\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A safe display name: no path separators or control characters, at most 255 characters. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(FORBIDDEN_CHARS, '').trim();
  const truncated = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  return truncated || 'file';
}

/** The URL-encoded `x-file-name` header; the raw value when it is not valid, '' when missing. */
export function decodeFileNameHeader(header: string | undefined): string {
  if (header === undefined) return '';
  try {
    return decodeURIComponent(header);
  } catch (error) {
    if (error instanceof URIError) return header;
    throw error;
  }
}
