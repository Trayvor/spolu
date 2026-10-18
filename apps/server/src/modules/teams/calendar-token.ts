import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Teams T1: the token of the public add-to-calendar page `/m/<token>`. 128 bits from HMAC of
// APP_SECRET over the meeting and a random nonce: the database holds the nonce and the token's
// SHA-256, never the token, yet an admin can show the link again. A new nonce revokes it.

/** 22 base64url characters = 128 bits. */
export const CALENDAR_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const newCalendarNonce = () => randomBytes(16).toString('base64url');

export function calendarToken(appSecret: string, itemId: string, nonce: string): string {
  return createHmac('sha256', appSecret)
    .update(`teams-calendar\0${itemId}\0${nonce}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export const calendarTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Whether `token` is the one derived for the row (constant time). */
export function isCalendarToken(
  appSecret: string,
  row: { itemId: string; calendarNonce: string | null },
  token: string,
): boolean {
  if (!row.calendarNonce || !CALENDAR_TOKEN.test(token)) return false;
  const expected = Buffer.from(calendarToken(appSecret, row.itemId, row.calendarNonce));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
