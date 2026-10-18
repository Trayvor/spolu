// Teams T1: what a pasted Teams join link tells. Microsoft warns that the format may change,
// so the tenant (`Tid`) and organizer (`Oid`) in a classic link are hints for which user to ask,
// never proof: the organizer Help stores is the one Graph returns.

export type ParsedTeamsLink =
  | {
      kind: 'classic';
      /** The link as pasted (trimmed): Graph's `JoinWebUrl` filter compares it. */
      joinWebUrl: string;
      tenantId: string | null;
      organizerId: string | null;
    }
  | { kind: 'meet'; joinWebUrl: string; joinMeetingId: string }
  /** A link of personal Teams (teams.live.com): never eGrant's tenant. */
  | { kind: 'personal' };

const WORK_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
const PERSONAL_HOSTS = new Set(['teams.live.com']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Teams meeting join link, or null when it is none. */
export function parseTeamsLink(input: string): ParsedTeamsLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (PERSONAL_HOSTS.has(host)) return { kind: 'personal' };
  if (!WORK_HOSTS.has(host)) return null;
  const path = url.pathname;
  // The short links of invitations since January 2026: /meet/<meeting ID>?p=<passcode>.
  const meet = /^\/meet\/(\d{6,20})\/?$/.exec(path);
  if (meet) return { kind: 'meet', joinWebUrl: input.trim(), joinMeetingId: meet[1]! };
  if (!/^\/l\/meetup-join\/[^/]+/i.test(path)) return null;
  let tenantId: string | null = null;
  let organizerId: string | null = null;
  const context = url.searchParams.get('context');
  if (context) {
    try {
      const parsed = JSON.parse(context) as { Tid?: unknown; Oid?: unknown };
      if (typeof parsed.Tid === 'string' && GUID.test(parsed.Tid)) {
        tenantId = parsed.Tid.toLowerCase();
      }
      if (typeof parsed.Oid === 'string' && GUID.test(parsed.Oid)) {
        organizerId = parsed.Oid.toLowerCase();
      }
    } catch {
      // No usable hints; the link still works with the JoinWebUrl filter.
    }
  }
  return { kind: 'classic', joinWebUrl: input.trim(), tenantId, organizerId };
}
