import { queryOptions } from '@tanstack/react-query';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { PasskeyListSchema, PasskeySchema, type Passkey } from '@spolu/shared';
import { webauthnOptions } from '@/features/auth/passkey';
import { apiGet, apiSend } from '@/lib/api';
import { createPasskeyResponse } from './webauthn';

/** The signed-in admin's own passkeys (ADR 0050). */
export const passkeysQuery = queryOptions({
  queryKey: ['me', 'passkeys'],
  queryFn: () => apiGet('/me/passkeys', PasskeyListSchema),
});

/** Emails the admin the code that lets a stale session add a passkey. */
export async function sendPasskeyCode(): Promise<void> {
  await apiSend('POST', '/me/passkeys/reauth', {});
}

/**
 * Adds a passkey named `name`: the server's options (with the emailed `code` when the session
 * is stale), the browser's dialog, then the server checks and stores it. Rejects with an
 * `ApiError` (`reauth_required`, `invalid_code`, `passkey_limit`, `passkey_invalid`) or the
 * browser's error.
 */
export async function addPasskey(name: string, code?: string): Promise<Passkey> {
  const options = await apiSend(
    'POST',
    '/me/passkeys/options',
    code === undefined ? {} : { code },
    webauthnOptions<PublicKeyCredentialCreationOptionsJSON>(),
  );
  const response = await createPasskeyResponse(options);
  return apiSend('POST', '/me/passkeys', { name, response }, PasskeySchema);
}

export async function deletePasskey(id: string): Promise<void> {
  await apiSend('DELETE', `/me/passkeys/${encodeURIComponent(id)}`);
}
