import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The weekly summary's personal unsubscribe token (spec §8):
 * `<userId>.<groupId>.<base64url HMAC-SHA256(secret, "weekly-summary-unsubscribe:<userId>:<groupId>")>`.
 * Nothing is stored; its purpose string differs from the bulk email token's, so neither opens
 * the other. User ids (better-auth) and group ids (UUIDs) never contain a dot.
 */

const signature = (secret: string, userId: string, groupId: string): Buffer =>
  createHmac('sha256', secret).update(`weekly-summary-unsubscribe:${userId}:${groupId}`).digest();

export function signSummaryUnsubscribeToken(
  secret: string,
  userId: string,
  groupId: string,
): string {
  return `${userId}.${groupId}.${signature(secret, userId, groupId).toString('base64url')}`;
}

/** The person and group of a valid token; null for a malformed or forged one. */
export function verifySummaryUnsubscribeToken(
  secret: string,
  token: string,
): { userId: string; groupId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, groupId, sig] = parts as [string, string, string];
  if (userId === '' || groupId === '' || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = signature(secret, userId, groupId);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (given.toString('base64url') !== sig) return null;
  return { userId, groupId };
}

/** The unsubscribe page and its RFC 8058 one-click endpoint for a token. */
export function summaryUnsubscribeUrls(
  publicUrl: string,
  token: string,
): { page: string; oneClick: string } {
  const base = publicUrl.replace(/\/+$/, '');
  return {
    page: `${base}/weekly-summary/unsubscribe/${token}`,
    oneClick: `${base}/api/weekly-summary/unsubscribe/${token}/one-click`,
  };
}
