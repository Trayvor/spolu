import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { isPasskeyCancel, passkeysSupported } from '@/features/auth/passkey';

/** The browser can make passkeys (WebAuthn); otherwise Settings shows a note. */
export const canCreatePasskeys = passkeysSupported;

export { isPasskeyCancel };

/**
 * Lets the browser make a passkey for the registration options (its own dialog: fingerprint,
 * face, PIN or another device). The WebAuthn library is a lazy chunk, loaded only here.
 */
export async function createPasskeyResponse(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  return startRegistration({ optionsJSON });
}
