import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import * as z from 'zod';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import type { Role } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobOptions } from '../../infra/jobs/jobs.js';
import { clientGroupIds } from '../groups/memberships.js';
import { ticketSignInLinks } from './schema.js';

/**
 * One-click sign-in from the "Ticket created" email (ADR 0020): the button carries a random
 * token that signs its user in and opens the ticket, without a login code. Only for a
 * ziadatel: not an admin, no active `client` membership of any group, not deactivated; checked
 * when the link is made and again when it is used.
 */

/** A link works for 7 days, as often as it is used (people click twice, or on two devices). */
export const TICKET_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The better-auth path of the sign-in endpoint (under /api/auth). */
export const TICKET_LINK_PATH = '/ticket-link/sign-in';

/** The error code of every refused link: unknown, expired, or its user no longer a ziadatel only. */
export const TICKET_LINK_INVALID = 'TICKET_LINK_INVALID';

/**
 * The email's job keeps the plaintext link in its payload: delete the finished job within a
 * minute instead of pg-boss's default week.
 */
export const TICKET_LINK_EMAIL_JOB_OPTIONS: JobOptions = { deleteAfterSeconds: 60 };

export const hashTicketToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** What a log line may carry about a token: the first 12 hex characters of its hash. */
export const ticketTokenLogId = (token: string): string => hashTicketToken(token).slice(0, 12);

/** Stores a new link for `userId` and `ticketId`; answers the token (shown only in the email). */
export async function createTicketLink(
  db: Db,
  input: { userId: string; ticketId: string },
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(ticketSignInLinks).values({
    id: randomUUID(),
    tokenHash: hashTicketToken(token),
    userId: input.userId,
    ticketId: input.ticketId,
    expiresAt: new Date(now.getTime() + TICKET_LINK_TTL_MS),
    createdAt: now,
  });
  return token;
}

/** Deletes the links that expired before `before`; answers how many (the daily auth cleanup). */
export async function deleteExpiredTicketLinks(db: Db, before = new Date()): Promise<number> {
  const deleted = await db
    .delete(ticketSignInLinks)
    .where(lt(ticketSignInLinks.expiresAt, before))
    .returning({ id: ticketSignInLinks.id });
  return deleted.length;
}

/**
 * Only a ziadatel may sign in with a link: role `client` (not an admin), not deactivated and no
 * active `client` membership (a full client of a group reaches the whole group, so they keep
 * the code login).
 */
async function mayUseLink(
  db: Db,
  u: { id: string; role: string; disabledAt?: Date | null },
): Promise<boolean> {
  if (u.role !== 'client' || u.disabledAt) return false;
  return (await clientGroupIds(db, u.id)).length === 0;
}

/**
 * The "Ticket created" email's button: a one-click sign-in link for a ziadatel (`oneClick`), the
 * login page (email filled in, back to the ticket) for an admin, a client of a group or anyone
 * else.
 */
export async function ticketEmailUrl(
  db: Db,
  publicUrl: string,
  account: { id: string; email: string; role: Role; disabledAt?: Date | null },
  ticketId: string,
): Promise<{ url: string; oneClick: boolean }> {
  if (await mayUseLink(db, account)) {
    const token = await createTicketLink(db, { userId: account.id, ticketId });
    // A fragment, not a path: it never reaches a server, proxy or log; the page posts it.
    return { url: `${publicUrl}/t#${token}`, oneClick: true };
  }
  const redirect = encodeURIComponent(`/tickets/${ticketId}`);
  const email = encodeURIComponent(account.email);
  return { url: `${publicUrl}/login?redirect=${redirect}&email=${email}`, oneClick: false };
}

type LinkUser = { id: string; email: string; role: string; disabledAt?: Date | null };

/**
 * The better-auth plugin with `POST /api/auth/ticket-link/sign-in` `{ token }`. A valid link
 * makes an ordinary session through better-auth (the session hooks, cookie and 60-day life of a
 * code sign-in) and answers `{ ticketId }`. Refused: 400 `TICKET_LINK_INVALID`, with the user's
 * email when the link was real and its user is not deactivated (to fill in the login page).
 * Signed in as someone else, that session ends first; as the same user, nothing new is made.
 */
export function ticketLinkPlugin(db: Db) {
  return {
    id: 'ticket-link',
    endpoints: {
      signInTicketLink: createAuthEndpoint(
        TICKET_LINK_PATH,
        { method: 'POST', body: z.object({ token: z.string().max(200) }) },
        async (ctx) => {
          const [link] = await db
            .select()
            .from(ticketSignInLinks)
            .where(eq(ticketSignInLinks.tokenHash, hashTicketToken(ctx.body.token)))
            .limit(1);
          const owner = link
            ? ((await ctx.context.internalAdapter.findUserById(link.userId)) as
                (LinkUser & Parameters<typeof setSessionCookie>[1]['user']) | null)
            : null;
          if (!link || !owner || link.expiresAt <= new Date() || !(await mayUseLink(db, owner))) {
            throw new APIError('BAD_REQUEST', {
              code: TICKET_LINK_INVALID,
              message: 'The link is not valid',
              ...(owner && !owner.disabledAt ? { email: owner.email } : {}),
            });
          }

          const current = await getSessionFromCtx(ctx);
          const touch = () =>
            db
              .update(ticketSignInLinks)
              .set({ lastUsedAt: new Date() })
              .where(eq(ticketSignInLinks.id, link.id));
          if (current?.user.id === owner.id) {
            await touch();
            return ctx.json({ ticketId: link.ticketId });
          }
          if (current) await ctx.context.internalAdapter.deleteSession(current.session.token);

          // Opening the link proves the inbox, as a code does: the same promotion as the
          // library's email-code and magic-link sign-ins.
          let verified = owner;
          if (!owner.emailVerified) {
            const promoted = await revokeUnprovenAccountAccess(ctx, owner.id);
            if (!promoted) throw new APIError('BAD_REQUEST', { code: TICKET_LINK_INVALID });
            verified = promoted as typeof owner;
          }
          const session = await ctx.context.internalAdapter.createSession(verified.id);
          await setSessionCookie(ctx, { session, user: verified });
          await touch();
          return ctx.json({ ticketId: link.ticketId });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
