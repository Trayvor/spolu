import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { changeUserEmail, getNotificationProfiles, normalizeEmail } from '../users/service.js';
import { CODE_ATTEMPTS, LOGIN_CODE_JOB_OPTIONS, LOGIN_CODE_TTL_SECONDS } from './auth.js';
import { emailChangeCodeEmail, emailChangedNoticeEmail } from './emails.js';
import { verification } from './schema.js';

export type EmailChangeDeps = Pick<AppDeps, 'config' | 'db' | 'jobs'>;

/** The new address is the one the account already has. */
export class SameEmailError extends Error {
  constructor() {
    super('The new email is the current one');
    this.name = 'SameEmailError';
  }
}

/** No request, another address, expired, used up, or a wrong code: all look the same. */
export class InvalidCodeError extends Error {
  constructor() {
    super('Invalid email change code');
    this.name = 'InvalidCodeError';
  }
}

/** One pending request per user, in better-auth's `verification` table. */
const identifierFor = (userId: string): string => `email-change:${userId}`;

const hmacSha256 = (secret: string, code: string): string =>
  createHmac('sha256', secret).update(code).digest('hex');

/** `<hash>:<newEmail>:<attempts>`; the hash is hex and the attempts a number, so neither has a colon. */
function parseValue(value: string): { hash: string; email: string; attempts: number } | null {
  const first = value.indexOf(':');
  const last = value.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const attempts = Number(value.slice(last + 1));
  if (!Number.isInteger(attempts)) return null;
  return { hash: value.slice(0, first), email: value.slice(first + 1, last), attempts };
}

const formatValue = (hash: string, email: string, attempts: number): string =>
  `${hash}:${email}:${attempts}`;

/** Serialises requests and confirmations of one user, so two of them never interleave. */
async function lockUser(tx: Db, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifierFor(userId)}))`);
}

async function loadProfile(db: Db, user: SessionUser) {
  const profile = (await getNotificationProfiles(db, [user.id])).get(user.id);
  return { email: profile?.email ?? user.email, language: profile?.language ?? 'sk' };
}

/**
 * Starts an email change: mails a 6-digit code to `newEmail` and replaces any earlier request.
 * The code goes out even when the address belongs to another account, so the answer never
 * tells whether an account exists; `confirmEmailChange` reports that, after the code.
 */
export async function requestEmailChange(
  { config, db, jobs }: EmailChangeDeps,
  user: SessionUser,
  newEmail: string,
): Promise<void> {
  const email = normalizeEmail(newEmail);
  const profile = await loadProfile(db, user);
  if (email === normalizeEmail(profile.email)) throw new SameEmailError();

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const identifier = identifierFor(user.id);
  await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier,
      value: formatValue(hmacSha256(config.appSecret, code), email, 0),
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_SECONDS * 1000),
    });
  });
  await sendEmailLater(
    jobs,
    emailChangeCodeEmail(email, code, profile.language),
    LOGIN_CODE_JOB_OPTIONS,
  );
}

/**
 * Finishes the caller's own email change. Throws `InvalidCodeError` (no request, another
 * address, expired, attempts used up, wrong code; a wrong code counts an attempt) or
 * `EmailTakenError` from `changeUserEmail`. Sessions are untouched. Notifies the old address.
 */
export async function confirmEmailChange(
  { config, db, jobs }: EmailChangeDeps,
  user: SessionUser,
  newEmail: string,
  code: string,
): Promise<void> {
  const email = normalizeEmail(newEmail);
  const identifier = identifierFor(user.id);
  const given = Buffer.from(hmacSha256(config.appSecret, code), 'hex');

  const accepted = await db.transaction(async (tx) => {
    await lockUser(tx, user.id);
    const [row] = await tx
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier));
    if (!row) return false;
    const parsed = parseValue(row.value);
    if (!parsed || parsed.email !== email) return false;
    if (row.expiresAt.getTime() <= Date.now() || parsed.attempts >= CODE_ATTEMPTS) return false;

    const expected = Buffer.from(parsed.hash, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await tx
        .update(verification)
        .set({
          value: formatValue(parsed.hash, parsed.email, parsed.attempts + 1),
          updatedAt: new Date(),
        })
        .where(eq(verification.id, row.id));
      return false;
    }
    await tx.delete(verification).where(eq(verification.id, row.id));
    return true;
  });
  if (!accepted) throw new InvalidCodeError();

  // Read before the change: the notice goes to the address the account had.
  const before = await loadProfile(db, user);
  await changeUserEmail(db, user.id, email);
  await sendEmailLater(jobs, emailChangedNoticeEmail(before.email, email, before.language));
}
