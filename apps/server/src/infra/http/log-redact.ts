/**
 * The request log of the search routes (message search, 2026-10-19): `q` can hold words of a
 * private message, so `/api/search` and `/api/search/...` are logged without their query string.
 */
export function redactSearchQuery(url: string): string {
  const query = url.indexOf('?');
  const path = query === -1 ? url : url.slice(0, query);
  return path === '/api/search' || path.startsWith('/api/search/') ? path : url;
}

/** Fastify's `serializers.req`: its default fields, with the url redacted. */
export function requestLogSerializer(req: {
  method: string;
  url: string;
  host?: string;
  ip?: string;
}): { method: string; url: string; host?: string; remoteAddress?: string } {
  return {
    method: req.method,
    url: redactSearchQuery(req.url),
    host: req.host,
    remoteAddress: req.ip,
  };
}
