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

/** A bare host (`mesto-x.egrant.sk`) from an eGrant webhook is read as `https://<host>`. */
export const egrantInstanceUrl = (instance: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(instance) ? instance : `https://${instance}`;
/**
 * The host an eGrant URL names, as tickets and projects match a client by it: no scheme, no
 * leading `www.`, lower-case. Null for anything that is not an http(s) URL.
 */
export function egrantHostOf(input: string): string | null {
  const normalized = normalizeEgrantUrl(input);
  return normalized === null ? null : new URL(normalized).host.replace(/^www\./, '');
}
