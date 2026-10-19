import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The token in a personal calendar feed's URL (ADR 0051): HMAC-SHA256 of APP_SECRET over the
// user and a random nonce, the full 32 bytes (256 bits). The database holds the nonce and the
// token's SHA-256, never the token, yet the settings card can show the link again (the Teams
// public page's pattern, `teams/calendar-token.ts`). A new nonce revokes it.

/** 43 base64url characters = 256 bits. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newFeedNonce = () => randomBytes(16).toString('base64url');

export function feedToken(appSecret: string, userId: string, nonce: string): string {
  return createHmac('sha256', appSecret)
    .update(`calendar-feed\0${userId}\0${nonce}`)
    .digest()
    .toString('base64url');
}

export const feedTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Whether `token` is the one derived for the row (constant time). */
export function isFeedToken(
  appSecret: string,
  row: { userId: string; nonce: string },
  token: string,
): boolean {
  if (!FEED_TOKEN.test(token)) return false;
  const expected = Buffer.from(feedToken(appSecret, row.userId, row.nonce));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
