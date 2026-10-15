import { MeSchema, type Me } from '@spolu/shared';
import { apiSend } from '@/lib/api';

/** Ask for a login code. The server answers 200 for unknown emails too. */
export async function sendCode(email: string): Promise<void> {
  await apiSend('POST', '/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
}

/** Exchange the emailed code for a session cookie. */
export async function verifyCode(email: string, otp: string): Promise<void> {
  await apiSend('POST', '/auth/sign-in/email-otp', { email, otp });
}

export async function signOut(): Promise<void> {
  await apiSend('POST', '/auth/sign-out', {});
}

/** Save the caller's display name; answers the updated profile. */
export async function updateName(name: string): Promise<Me> {
  return apiSend('PATCH', '/me', { name }, MeSchema);
}
