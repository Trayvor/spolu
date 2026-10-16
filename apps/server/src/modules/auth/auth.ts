import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { user } from '../users/schema.js';
import { applyPendingInvite } from '../groups/memberships.js';
import { findUserByEmail, getUserById } from '../users/service.js';
import { loginCodeEmail } from './emails.js';
import { pickLanguage } from './language.js';
import { account, session, verification } from './schema.js';

/** How long a login code (and an email-change code) stays valid. */
export const LOGIN_CODE_TTL_SECONDS = 300;
/** Wrong tries a code allows before it is used up. */
export const CODE_ATTEMPTS = 3;

/** Same as the code's life (300 s) or shorter; finished jobs, and their payload, go quickly. */
export const LOGIN_CODE_JOB_OPTIONS = {
  expireInSeconds: 240,
  retentionSeconds: 240,
  deleteAfterSeconds: 60,
};

/**
 * The better-auth instance: email-code login only, sessions in the database.
 * Users are created by us (superadmin on start, admins by admins), never by sign-up.
 */
export function createAuth({ config, db, jobs }: AppDeps) {
  return betterAuth({
    secret: config.appSecret,
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    // In dev the browser is on Vite (:5173), whose proxy keeps the page's Origin header.
    trustedOrigins: config.nodeEnv === 'development' ? ['http://localhost:5173'] : [],
    telemetry: { enabled: false },
    // The adapter gets the users module's `user` table too: the one documented exception
    // to the module boundary rule.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    session: { expiresIn: 5_184_000, updateAge: 86_400 }, // 60 days, sliding once a day
    user: {
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'client', input: false },
        disabledAt: { type: 'date', required: false, input: false },
      },
    },
    // The library defaults (on only in production: 3 code requests per minute per IP and
    // path), but read from our config: better-auth itself looks at process.env.NODE_ENV.
    rateLimit: { enabled: config.nodeEnv === 'production' },
    advanced: {
      // better-auth skips its Origin (CSRF) check when it detects a test run; keep it on
      // everywhere so tests exercise what production does.
      disableOriginCheck: false,
      // A function, not 'uuid': with 'uuid' on postgres the adapter leaves the id to a column
      // default, and our id columns are plain text without one.
      database: { generateId: () => randomUUID() },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const owner = await getUserById(db, newSession.userId);
            // Throw, don't return false: `false` makes sign-in crash with a 500.
            if (owner?.disabledAt) {
              throw new APIError('FORBIDDEN', {
                message: 'Account disabled',
                code: 'ACCOUNT_DISABLED',
              });
            }
            // Signing in with a code proves the email: only now does the invite the person
            // typed it on make them a client of that group.
            if (owner?.role === 'client') await applyPendingInvite(db, owner.id);
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: LOGIN_CODE_TTL_SECONDS,
        allowedAttempts: CODE_ATTEMPTS,
        // Colleagues behind one office IP share the limit (library default 3 per minute; ours 10,
        // raised for e2e, whose browsers all log in from 127.0.0.1); the brute-force guard is
        // allowedAttempts. Plugin rules win over the library's /sign-in special rule.
        rateLimit: { window: 60, max: config.loginCodesPerMinute },
        disableSignUp: true, // unknown emails get 200 but no code and no account
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== 'sign-in') return;
          const found = await findUserByEmail(db, email);
          // Disabled users get the same 200 as everyone else, just no email.
          if (!found || found.disabledAt) return;
          const lang = pickLanguage(ctx?.headers?.get('accept-language'));
          // Short life: the plaintext code sits in the job payload, and a late retry would mail a dead code.
          await sendEmailLater(jobs, loginCodeEmail(email, otp, lang), LOGIN_CODE_JOB_OPTIONS);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
