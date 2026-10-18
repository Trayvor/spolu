import { z } from 'zod';

/**
 * Passkeys (WebAuthn) of admins (ADR 0050): an alternative to the email code, never a
 * replacement. Clients and requesters keep the code login only.
 */
export const PASSKEY_LIMITS = { name: 60, perUser: 10 } as const;

/** One of the signed-in admin's own passkeys, as the settings list shows it. */
export const PasskeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type Passkey = z.infer<typeof PasskeySchema>;
export const PasskeyListSchema = z.array(PasskeySchema);

/**
 * `POST /api/me/passkeys/options`: the registration options. Without a fresh session (signed in
 * within `PASSKEY_FRESH_SESSION_MINUTES`) the body carries the 6-digit re-check code that
 * `POST /api/me/passkeys/reauth` emailed.
 */
export const PasskeyOptionsBodySchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type PasskeyOptionsBody = z.infer<typeof PasskeyOptionsBodySchema>;

/** A session younger than this registers a passkey without the code re-check. */
export const PASSKEY_FRESH_SESSION_MINUTES = 10;

/**
 * `POST /api/me/passkeys`: the browser's answer to the registration options, with the name the
 * admin gave the passkey. The response itself is checked by the server's WebAuthn library.
 */
export const PasskeyCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(PASSKEY_LIMITS.name),
  response: z.looseObject({ id: z.string().max(1024), type: z.literal('public-key') }),
});
export type PasskeyCreateBody = z.infer<typeof PasskeyCreateBodySchema>;
