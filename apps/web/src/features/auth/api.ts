import { InviteContextSchema, MeSchema, type InviteContext, type Me } from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** Ask for a login code. The server answers 200 for unknown emails too. */
export async function sendCode(email: string): Promise<void> {
  await apiSend('POST', '/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
}

/** Exchange the emailed code for a session cookie. */
export async function verifyCode(email: string, otp: string): Promise<void> {
  await apiSend('POST', '/auth/sign-in/email-otp', { email, otp });
}

export async function signOut(): Promise<void> {
  // Drop this device's push subscription while the session is still valid; never block logout.
  try {
    await (await import('@/features/notifications/push-device')).forgetThisDevice();
  } catch {
    // Best effort: a failed cleanup must not keep the user signed in.
  }
  await apiSend('POST', '/auth/sign-out', {});
}

/** Save the caller's display name; answers the updated profile. */
export async function updateName(name: string): Promise<Me> {
  return apiSend('PATCH', '/me', { name }, MeSchema);
}

/**
 * What an invitation link's signed context says (X19): who invited the person to which group.
 * Rejects (404) for a forged or outdated link; the login page then shows nothing extra.
 */
export function getInviteContext(token: string, email: string): Promise<InviteContext> {
  const q = `token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  return apiGet(`/invitations/context?${q}`, InviteContextSchema);
}

const INVITE_KEY = 'spolu.invite';

/** Keeps the context for `/welcome`, in this tab only (the login and the name step share it). */
export function rememberInvite(context: InviteContext): void {
  try {
    sessionStorage.setItem(INVITE_KEY, JSON.stringify(context));
  } catch {
    // Storage blocked: the welcome page shows only what Help is for.
  }
}

/** The remembered context, or null; anything malformed counts as none. */
export function recalledInvite(): InviteContext | null {
  try {
    const parsed = InviteContextSchema.safeParse(
      JSON.parse(sessionStorage.getItem(INVITE_KEY) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // Nothing stored.
  }
}
