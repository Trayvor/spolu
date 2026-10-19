import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers';
import {
  PASSKEY_FRESH_SESSION_MINUTES,
  PASSKEY_LIMITS,
  type Passkey,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { user } from '../users/schema.js';
import { isAdmin } from '../users/policy.js';
import { CODE_ATTEMPTS, LOGIN_CODE_JOB_OPTIONS, LOGIN_CODE_TTL_SECONDS } from './auth.js';
import { passkeyAddedEmail, passkeyCodeEmail } from './emails.js';
import { passkeys, verification } from './schema.js';
import { toSessionUser } from './session.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields } from '../audit/diff.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';

/**
 * Passkeys (WebAuthn) for admins (ADR 0050), an alternative to the email code. The ceremonies
 * use @simplewebauthn/server. Every challenge is made here, stored in better-auth's
 * `verification` table, lives `CHALLENGE_TTL_MS` and is deleted by the first answer to it
 * (single use). The RP ID and origin come from PUBLIC_URL. Passkeys are discoverable and always
 * user-verified; the signature counter must grow when the authenticator counts.
 */

export type PasskeyDeps = Pick<AppDeps, 'config' | 'db' | 'jobs'>;

/** The admin already has `PASSKEY_LIMITS.perUser` passkeys. */
export class PasskeyLimitError extends Error {}
/** No, an expired or a used challenge, or an answer the WebAuthn checks refused. */
export class PasskeyInvalidError extends Error {}

/** How long the browser has to answer a challenge. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = 'Help by eGrant';

const registerIdentifier = (userId: string) => `passkey-register:${userId}`;
const loginIdentifier = (challenge: string) => `passkey-login:${challenge}`;
const reauthIdentifier = (userId: string) => `passkey-reauth:${userId}`;

/** The RP ID (PUBLIC_URL's host) and the origins a ceremony may come from. */
export function relyingParty(config: PasskeyDeps['config']): { rpID: string; origins: string[] } {
  const url = new URL(config.publicUrl);
  // In dev the browser is on Vite (:5173), as in better-auth's trusted origins.
  const origins = [url.origin];
  if (config.nodeEnv === 'development') origins.push('http://localhost:5173');
  return { rpID: url.hostname, origins };
}

/**
 * The WebAuthn user handle of a user: an HMAC of the id, so the authenticator never holds our
 * user id, and the same for every passkey of one user (a second one on the same device
 * replaces the first instead of piling up).
 */
function userHandleFor(appSecret: string, userId: string): Uint8Array<ArrayBuffer> {
  const digest = createHmac('sha256', appSecret).update(`webauthn-user:${userId}`).digest();
  return new Uint8Array(digest);
}

/** A session younger than `PASSKEY_FRESH_SESSION_MINUTES` may add a passkey without the code. */
export function isFreshSession(createdAt: Date, now = new Date()): boolean {
  return now.getTime() - createdAt.getTime() < PASSKEY_FRESH_SESSION_MINUTES * 60_000;
}

function toDto(row: typeof passkeys.$inferSelect): Passkey {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** The user's passkeys, oldest first. */
export async function listPasskeys(db: Db, userId: string): Promise<Passkey[]> {
  const rows = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
  return rows.map(toDto);
}

/** Deletes one of the user's own passkeys; false for another user's or an unknown one. */
export async function deletePasskey(
  db: Db,
  userId: string,
  id: string,
  by?: AuditActor,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning({ id: passkeys.id, name: passkeys.name });
    if (by)
      await recordAudit(
        tx,
        by,
        rows.map((p) => passkeyEntry(p, 'deleted')),
      );
    return rows.length > 0;
  });
}

const passkeyEntry = (
  p: { id: string; name: string },
  action: 'added' | 'deleted',
): AuditEntry => ({
  entityType: 'passkey',
  entityId: p.id,
  entityLabel: p.name,
  groupId: null,
  action,
  changes: action === 'added' ? diffFields('passkey', null, { name: p.name }) : {},
});

/** Deletes the verification row and answers its value, only while it has not expired. */
async function consume(db: Db, identifier: string): Promise<string | null> {
  const [row] = await db
    .delete(verification)
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
    .returning({ value: verification.value });
  return row?.value ?? null;
}

// --- The code re-check of a stale session -------------------------------------------------

const hmacSha256 = (secret: string, code: string): string =>
  createHmac('sha256', secret).update(code).digest('hex');

/**
 * Mails the admin a 6-digit code (5 minutes, 3 tries) that lets a stale session add a passkey;
 * a new one replaces the old.
 */
export async function sendReauthCode(
  { config, db, jobs }: PasskeyDeps,
  admin: SessionUser,
): Promise<void> {
  const [profile] = await db
    .select({ email: user.email, language: user.language })
    .from(user)
    .where(eq(user.id, admin.id));
  if (!profile) return;
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const identifier = reauthIdentifier(admin.id);
  await db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier,
      value: `${hmacSha256(config.appSecret, code)}:0`,
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_SECONDS * 1000),
    });
  });
  await sendEmailLater(
    jobs,
    passkeyCodeEmail(
      { to: profile.email, lang: profile.language, publicUrl: config.publicUrl },
      code,
    ),
    LOGIN_CODE_JOB_OPTIONS,
  );
}

/**
 * Uses the admin's re-check code: true and gone when right; a wrong one counts a try, the third
 * wrong one (or an expired code) leaves nothing to use.
 */
export async function useReauthCode(
  { config, db }: Pick<PasskeyDeps, 'config' | 'db'>,
  userId: string,
  code: string,
): Promise<boolean> {
  const identifier = reauthIdentifier(userId);
  const given = Buffer.from(hmacSha256(config.appSecret, code), 'hex');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
    const [row] = await tx
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier));
    if (!row) return false;
    const [hash = '', triesText = ''] = row.value.split(':');
    const tries = Number(triesText);
    if (
      row.expiresAt.getTime() <= Date.now() ||
      !Number.isInteger(tries) ||
      tries >= CODE_ATTEMPTS
    ) {
      await tx.delete(verification).where(eq(verification.id, row.id));
      return false;
    }
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await tx
        .update(verification)
        .set({ value: `${hash}:${tries + 1}`, updatedAt: new Date() })
        .where(eq(verification.id, row.id));
      return false;
    }
    await tx.delete(verification).where(eq(verification.id, row.id));
    return true;
  });
}

// --- Registration ----------------------------------------------------------------------------

/**
 * The options for a new passkey of the admin; replaces a pending registration. Throws
 * `PasskeyLimitError` at the limit. The caller has checked the session's freshness or the code.
 */
export async function registrationOptions(
  { config, db }: Pick<PasskeyDeps, 'config' | 'db'>,
  admin: SessionUser,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, admin.id));
  if (existing.length >= PASSKEY_LIMITS.perUser) throw new PasskeyLimitError();
  const { rpID } = relyingParty(config);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: admin.email,
    userDisplayName: admin.name,
    userID: userHandleFor(config.appSecret, admin.id),
    timeout: CHALLENGE_TTL_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: splitTransports(p.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  });
  const identifier = registerIdentifier(admin.id);
  await db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier,
      value: options.challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  });
  return options;
}

const splitTransports = (value: string) =>
  value === '' ? undefined : (value.split(',') as AuthenticatorTransport[]);

/**
 * Checks the browser's answer to the admin's pending registration and stores the passkey.
 * Throws `PasskeyInvalidError` (no pending challenge, expired, used, or refused by the checks)
 * or `PasskeyLimitError`. Then mails the admin that a passkey was added; a failure to queue it
 * is logged, never thrown.
 */
export async function finishRegistration(
  { config, db, jobs }: PasskeyDeps,
  admin: SessionUser,
  input: { name: string; response: unknown },
  log: { error(obj: object, msg: string): void },
  by?: AuditActor,
): Promise<Passkey> {
  const challenge = await consume(db, registerIdentifier(admin.id));
  if (!challenge) throw new PasskeyInvalidError();
  const { rpID, origins } = relyingParty(config);
  let info;
  try {
    const result = await verifyRegistrationResponse({
      response: input.response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo.userVerified) throw new PasskeyInvalidError();
    info = result.registrationInfo;
  } catch {
    throw new PasskeyInvalidError();
  }

  const now = new Date();
  const row = await db.transaction(async (tx) => {
    // Serialises the admin's registrations, so two at once cannot both pass the count.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, admin.id)).for('update');
    const [held] = await tx
      .select({ n: count() })
      .from(passkeys)
      .where(eq(passkeys.userId, admin.id));
    if ((held?.n ?? 0) >= PASSKEY_LIMITS.perUser) throw new PasskeyLimitError();
    const [inserted] = await tx
      .insert(passkeys)
      .values({
        id: randomUUID(),
        userId: admin.id,
        name: input.name,
        credentialId: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        webauthnUserId: isoBase64URL.fromBuffer(userHandleFor(config.appSecret, admin.id)),
        counter: info.credential.counter,
        transports: (info.credential.transports ?? []).join(','),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: now,
      })
      .onConflictDoNothing({ target: passkeys.credentialId })
      .returning();
    if (inserted && by) await recordAudit(tx, by, [passkeyEntry(inserted, 'added')]);
    return inserted ?? null;
  });
  if (!row) throw new PasskeyInvalidError(); // the credential is already registered

  try {
    const [profile] = await db
      .select({ email: user.email, language: user.language })
      .from(user)
      .where(eq(user.id, admin.id));
    if (profile) {
      await sendEmailLater(
        jobs,
        passkeyAddedEmail(
          { to: profile.email, lang: profile.language, publicUrl: config.publicUrl },
          { name: row.name, createdAt: row.createdAt },
        ),
      );
    }
  } catch (error) {
    log.error({ err: error }, 'could not queue the passkey notice');
  }
  return toDto(row);
}

// --- Login -----------------------------------------------------------------------------------

/** Options for a sign-in with any discoverable passkey of this site (also for autofill). */
export async function loginOptions({
  config,
  db,
}: Pick<PasskeyDeps, 'config' | 'db'>): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = relyingParty(config);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
  });
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: loginIdentifier(options.challenge),
    value: '',
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return options;
}

/** The challenge in a WebAuthn answer's clientDataJSON, or null when it cannot be read. */
function challengeOf(response: unknown): string | null {
  try {
    const data = (response as { response?: { clientDataJSON?: unknown } }).response?.clientDataJSON;
    if (typeof data !== 'string' || data.length > 4096) return null;
    const challenge = decodeClientDataJSON(data).challenge;
    return typeof challenge === 'string' && challenge.length <= 200 ? challenge : null;
  } catch {
    return null;
  }
}

/**
 * Checks a sign-in answer and answers the id of the admin to sign in. The challenge goes first
 * (used even when the rest fails). Throws `PasskeyInvalidError` for an unknown, used or expired
 * challenge, an unknown passkey, a failed check (signature, origin, RP ID, user verification, a
 * counter that did not grow, another user handle) and for a user who is no longer an admin or
 * is deactivated: they sign in with the email code.
 */
export async function verifyLogin(
  { config, db }: Pick<PasskeyDeps, 'config' | 'db'>,
  response: unknown,
): Promise<string> {
  const challenge = challengeOf(response);
  if (!challenge || (await consume(db, loginIdentifier(challenge))) === null) {
    throw new PasskeyInvalidError();
  }
  const answer = response as AuthenticationResponseJSON;
  if (typeof answer.id !== 'string') throw new PasskeyInvalidError();
  const [row] = await db
    .select({
      passkey: passkeys,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabledAt: user.disabledAt,
      financeAccessAt: user.financeAccessAt,
    })
    .from(passkeys)
    .innerJoin(user, eq(user.id, passkeys.userId))
    .where(eq(passkeys.credentialId, answer.id));
  if (!row) throw new PasskeyInvalidError();
  const owner = toSessionUser(row);
  if (!owner || !isAdmin(owner)) throw new PasskeyInvalidError();
  if (answer.response?.userHandle !== row.passkey.webauthnUserId) throw new PasskeyInvalidError();

  const { rpID, origins } = relyingParty(config);
  let info;
  try {
    const result = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: row.passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(row.passkey.publicKey),
        counter: row.passkey.counter,
        transports: splitTransports(row.passkey.transports),
      },
    });
    if (!result.verified || !result.authenticationInfo.userVerified)
      throw new PasskeyInvalidError();
    info = result.authenticationInfo;
  } catch {
    throw new PasskeyInvalidError();
  }
  // Compare-and-set: of two answers checked against the same counter, only one may win.
  const updated = await db
    .update(passkeys)
    .set({ counter: info.newCounter, backedUp: info.credentialBackedUp, lastUsedAt: new Date() })
    .where(and(eq(passkeys.id, row.passkey.id), eq(passkeys.counter, row.passkey.counter)))
    .returning({ id: passkeys.id });
  if (updated.length === 0) throw new PasskeyInvalidError();
  return owner.id;
}
