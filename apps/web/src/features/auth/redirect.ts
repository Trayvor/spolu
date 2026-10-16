/**
 * A login redirect target is only accepted when it is a path on this site; anything else becomes `/`.
 * Backslashes, tabs and line breaks are refused anywhere: URL parsers drop or convert them,
 * so `/\t/evil.example` would turn into `//evil.example`.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  if (value.startsWith('//') || /[\\\t\r\n]/.test(value)) return '/';
  return value;
}

/**
 * The `?email=` of an invitation's login link, used to prefill the field: a string of at most
 * 254 characters with an `@`, else undefined.
 */
export function linkEmail(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 254 && value.includes('@')
    ? value
    : undefined;
}
