import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed context of an invitation link (X19, ADR 0043), so `/login` and `/welcome` can say
 * who invited the person to which group:
 * `<groupId>.<base64url(inviter's name)>.<issued at, Unix seconds>.<base64url HMAC-SHA256(secret, "invite:<groupId>:<issued>:<name>:<email>")>`.
 * The signature covers the invited email (lower case), so a token only answers together with
 * that email, and the issue time, so a token expires `INVITE_TOKEN_DAYS` after it was made
 * (2026-10-18, review V11). Nothing is stored; rotating `APP_SECRET` invalidates old links, which
 * then simply show the plain login page, as an expired one does. Group ids (UUIDs) never contain
 * a dot.
 */
export const INVITE_TOKEN_DAYS = 30;
const DAY_SECONDS = 86_400;
/** A token dated this far ahead (clock skew between instances) still counts. */
const FUTURE_SKEW_SECONDS = 300;

const signature = (
  secret: string,
  groupId: string,
  issued: string,
  invitedBy: string,
  email: string,
): Buffer =>
  createHmac('sha256', secret)
    .update(`invite:${groupId}:${issued}:${invitedBy}:${email.trim().toLowerCase()}`)
    .digest();

export function signInviteToken(
  secret: string,
  input: { groupId: string; invitedBy: string; email: string },
  now: Date = new Date(),
): string {
  const name = Buffer.from(input.invitedBy, 'utf8').toString('base64url');
  const issued = String(Math.floor(now.getTime() / 1000));
  const sig = signature(secret, input.groupId, issued, input.invitedBy, input.email).toString(
    'base64url',
  );
  return `${input.groupId}.${name}.${issued}.${sig}`;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

/**
 * The group and inviter of a valid, unexpired token for this email; null for a malformed,
 * forged, expired or future-dated one.
 */
export function verifyInviteToken(
  secret: string,
  token: string,
  email: string,
  now: Date = new Date(),
): { groupId: string; invitedBy: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [groupId, name, issued, sig] = parts as [string, string, string, string];
  if (groupId === '' || !B64URL.test(name) || sig === '' || !B64URL.test(sig)) return null;
  if (!/^[1-9][0-9]{0,11}$/.test(issued)) return null;
  const invitedBy = Buffer.from(name, 'base64url').toString('utf8');
  const given = Buffer.from(sig, 'base64url');
  const expected = signature(secret, groupId, issued, invitedBy, email);
  // Compare in constant time; a wrong length is rejected first (timingSafeEqual needs equal).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // base64url decoding ignores trailing bits: accept only the canonical spelling.
  if (given.toString('base64url') !== sig) return null;
  const age = now.getTime() / 1000 - Number(issued);
  if (age < -FUTURE_SKEW_SECONDS || age > INVITE_TOKEN_DAYS * DAY_SECONDS) return null;
  return { groupId, invitedBy };
}

/** The invitation email's sign-in link: the email to fill in and the signed context. */
export function inviteLoginUrl(
  publicUrl: string,
  secret: string,
  input: { groupId: string; invitedBy: string; email: string },
): string {
  const token = signInviteToken(secret, input);
  return `${publicUrl}/login?email=${encodeURIComponent(input.email)}&invite=${token}`;
}
