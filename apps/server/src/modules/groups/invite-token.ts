import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed context of an invitation link (X19, ADR 0043), so `/login` and `/welcome` can say
 * who invited the person to which group:
 * `<groupId>.<base64url(inviter's name)>.<base64url HMAC-SHA256(secret, "invite:<groupId>:<name>:<email>")>`.
 * The signature covers the invited email (lower case), so a token only answers together with
 * that email. Nothing is stored; rotating `APP_SECRET` invalidates old links, which then simply
 * show the plain login page. Group ids (UUIDs) never contain a dot.
 */
const signature = (secret: string, groupId: string, invitedBy: string, email: string): Buffer =>
  createHmac('sha256', secret)
    .update(`invite:${groupId}:${invitedBy}:${email.trim().toLowerCase()}`)
    .digest();

export function signInviteToken(
  secret: string,
  input: { groupId: string; invitedBy: string; email: string },
): string {
  const name = Buffer.from(input.invitedBy, 'utf8').toString('base64url');
  const sig = signature(secret, input.groupId, input.invitedBy, input.email).toString('base64url');
  return `${input.groupId}.${name}.${sig}`;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

/** The group and inviter of a valid token for this email; null for a malformed or forged one. */
export function verifyInviteToken(
  secret: string,
  token: string,
  email: string,
): { groupId: string; invitedBy: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [groupId, name, sig] = parts as [string, string, string];
  if (groupId === '' || !B64URL.test(name) || sig === '' || !B64URL.test(sig)) return null;
  const invitedBy = Buffer.from(name, 'base64url').toString('utf8');
  const given = Buffer.from(sig, 'base64url');
  const expected = signature(secret, groupId, invitedBy, email);
  // Compare in constant time; a wrong length is rejected first (timingSafeEqual needs equal).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // base64url decoding ignores trailing bits: accept only the canonical spelling.
  if (given.toString('base64url') !== sig) return null;
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
