import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of an `Authorization: Bearer <key>` header against the shared key (the
 * eGrant ticket intake and the eGrant project endpoint). A missing header or another scheme
 * never matches.
 */
export function bearerKeyMatches(header: string | undefined, key: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const wanted = Buffer.from(key);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
