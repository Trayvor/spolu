/** The longest URL a knowledge link or a task link may have. */
export const MAX_URL_LENGTH = 2048;

/** An absolute http or https URL of at most 2048 characters (links, never `javascript:`). */
export function isHttpUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
