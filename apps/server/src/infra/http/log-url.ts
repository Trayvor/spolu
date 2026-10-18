/**
 * A request URL as the log may show it: the token of a personal calendar feed URL
 * (`/api/public/calendar/<token>/…`, ADR 0051) becomes `:token`, every other URL is unchanged.
 * The token is the feed's only credential, so it must never reach a log.
 */
export function logUrl(url: string): string {
  return url.replace(/^(\/api\/public\/calendar\/)[^/?#]*/, '$1:token');
}
