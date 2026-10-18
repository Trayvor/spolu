import { apiSend, type ResponseParser } from '@/lib/api';

/**
 * The admins' passkey login in the browser (ADR 0050). The WebAuthn code (@simplewebauthn/browser)
 * is a lazy chunk, imported only when a passkey is used, never with the login page itself.
 */

/** The browser has WebAuthn at all; the login page offers the passkey button only then. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

const webauthn = () => import('@simplewebauthn/browser');

/**
 * WebAuthn options from the server: an object with a challenge (the library checks the rest).
 * A hand-written guard, as the login page loads no zod schema for them.
 */
export function webauthnOptions<T>(): ResponseParser<T> {
  return {
    safeParse: (data) =>
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { challenge?: unknown }).challenge === 'string'
        ? { success: true, data: data as T }
        : { success: false },
  };
}

/**
 * The browser shows saved passkeys in the email field's autofill (conditional mediation). Asks
 * the browser directly, so a browser without it never loads the WebAuthn chunk or asks the
 * server for a challenge.
 */
export async function passkeyAutofillSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (
    window.PublicKeyCredential as { isConditionalMediationAvailable?: () => Promise<boolean> }
  ).isConditionalMediationAvailable;
  if (typeof check !== 'function') return false;
  try {
    return await check.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

/**
 * Signs in with a passkey: asks the server for a challenge, lets the browser ask the person
 * (the modal dialog, or with `autofill` the email field's suggestions; the promise waits until
 * one is picked) and sends the answer. Starting one cancels a pending one. Rejects with the
 * browser's error (`NotAllowedError` when the person cancels, `AbortError` when cancelled) or
 * an `ApiError` (`PASSKEY_INVALID`: the passkey cannot be used).
 */
export async function signInWithPasskey({ autofill = false } = {}): Promise<void> {
  const { startAuthentication } = await webauthn();
  const optionsJSON = await apiSend(
    'POST',
    '/auth/passkey/options',
    {},
    webauthnOptions<Parameters<typeof startAuthentication>[0]['optionsJSON']>(),
  );
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  await apiSend('POST', '/auth/passkey/sign-in', { response });
}

/** Ends a pending autofill sign-in (the login page leaves, or the code flow takes over). */
export async function cancelPasskey(): Promise<void> {
  try {
    (await webauthn()).WebAuthnAbortService.cancelCeremony();
  } catch {
    // Nothing pending, or the chunk never loaded.
  }
}

/** The person cancelled or the ceremony was aborted: no message needed. */
export function isPasskeyCancel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string; code?: string }).name;
  const code = (error as { code?: string }).code;
  return (
    name === 'NotAllowedError' ||
    name === 'AbortError' ||
    code === 'ERROR_CEREMONY_ABORTED' ||
    code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
  );
}
