/**
 * The origin of an eGrant URL: lower-case scheme and host, no default port, path, query or fragment.
 * Returns null for anything that is not http(s). Also used by Phase 12 ticket matching.
 */
export function normalizeEgrantUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // URL already lower-cases scheme and host and drops default ports. A trailing dot (an
  // absolute DNS name) names the same host, so drop it.
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
  return url.origin;
}
