import * as z from 'zod';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { loginOptions, PasskeyInvalidError, verifyLogin, type PasskeyDeps } from './passkeys.js';

/** The better-auth paths (under /api/auth) of the passkey login (ADR 0050). */
export const PASSKEY_OPTIONS_PATH = '/passkey/options';
export const PASSKEY_SIGN_IN_PATH = '/passkey/sign-in';

/** The error code of every refused passkey sign-in; the login page offers the email code. */
const PASSKEY_INVALID = 'PASSKEY_INVALID';

/**
 * The better-auth plugin of the admins' passkey login: `POST /api/auth/passkey/options` answers
 * the WebAuthn request options (a stored, single-use challenge), `POST /api/auth/passkey/sign-in`
 * `{ response }` checks the browser's answer and makes an ordinary session through better-auth
 * (the session hooks, cookie and 60-day life of a code sign-in). Signed in as someone else,
 * that session ends first. The rate limits are in `routes.ts`, per address.
 */
export function passkeyLoginPlugin(deps: Pick<PasskeyDeps, 'config' | 'db'>) {
  return {
    id: 'admin-passkey',
    endpoints: {
      passkeyOptions: createAuthEndpoint(PASSKEY_OPTIONS_PATH, { method: 'POST' }, async (ctx) =>
        ctx.json(await loginOptions(deps)),
      ),
      passkeySignIn: createAuthEndpoint(
        PASSKEY_SIGN_IN_PATH,
        {
          method: 'POST',
          body: z.object({
            response: z.looseObject({ id: z.string().max(1024), type: z.literal('public-key') }),
          }),
        },
        async (ctx) => {
          let userId: string;
          try {
            userId = await verifyLogin(deps, ctx.body.response);
          } catch (error) {
            if (!(error instanceof PasskeyInvalidError)) throw error;
            throw new APIError('BAD_REQUEST', {
              code: PASSKEY_INVALID,
              message: 'The passkey cannot be used',
            });
          }
          const owner = (await ctx.context.internalAdapter.findUserById(userId)) as
            Parameters<typeof setSessionCookie>[1]['user'] | null;
          if (!owner) throw new APIError('BAD_REQUEST', { code: PASSKEY_INVALID });
          const current = await getSessionFromCtx(ctx);
          if (current) await ctx.context.internalAdapter.deleteSession(current.session.token);
          const session = await ctx.context.internalAdapter.createSession(owner.id);
          await setSessionCookie(ctx, { session, user: owner });
          return ctx.json({ success: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
