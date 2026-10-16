import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed unsubscribe token of one person and one campaign (spec §5):
 * `<userId>.<campaignId>.<base64url HMAC-SHA256(secret, "bulk-unsubscribe:<userId>:<campaignId>")>`.
 * Nothing is stored; rotating `APP_SECRET` invalidates old links. A test email uses the
 * campaign id `test`. User ids (better-auth) and campaign ids (UUIDs) never contain a dot.
 */
export const TEST_CAMPAIGN_ID = 'test';

const signature = (secret: string, userId: string, campaignId: string): Buffer =>
  createHmac('sha256', secret).update(`bulk-unsubscribe:${userId}:${campaignId}`).digest();

export function signUnsubscribeToken(secret: string, userId: string, campaignId: string): string {
  const sig = signature(secret, userId, campaignId).toString('base64url');
  return `${userId}.${campaignId}.${sig}`;
}

/** The person and campaign of a valid token; null for a malformed or forged one. */
export function verifyUnsubscribeToken(
  secret: string,
  token: string,
): { userId: string; campaignId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, campaignId, sig] = parts as [string, string, string];
  if (userId === '' || campaignId === '' || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = signature(secret, userId, campaignId);
  // Compare in constant time; a wrong length is rejected first (timingSafeEqual needs equal).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  // base64url decoding ignores trailing bits: accept only the canonical spelling.
  if (given.toString('base64url') !== sig) return null;
  return { userId, campaignId };
}

/** Spolu's unsubscribe page and its RFC 8058 one-click endpoint for a token. */
export function unsubscribeUrls(
  publicUrl: string,
  token: string,
): { page: string; oneClick: string } {
  const base = publicUrl.replace(/\/+$/, '');
  return {
    page: `${base}/unsubscribe/${token}`,
    oneClick: `${base}/api/bulk-email/unsubscribe/${token}/one-click`,
  };
}
