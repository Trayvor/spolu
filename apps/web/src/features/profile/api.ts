import { queryOptions } from '@tanstack/react-query';
import { BulkSubscriptionSchema, MeSchema, type Me } from '@spolu/shared';
import { isLanguage } from '@/i18n/detect';
import { apiGet, apiSend } from '@/lib/api';

/** Send a 6-digit code to the new address; the email changes only after `confirmEmailChange`. */
export async function requestEmailChange(newEmail: string): Promise<void> {
  await apiSend('POST', '/me/email-change', { newEmail });
}

/** Exchange the code for the new address; answers the updated profile. */
export function confirmEmailChange(newEmail: string, code: string): Promise<Me> {
  return apiSend('POST', '/me/email-change/confirm', { newEmail, code }, MeSchema);
}

/** Store the UI language on the server (emails and pushes use it). Unknown codes are ignored. */
export async function saveLanguage(language: string): Promise<void> {
  if (!isLanguage(language)) return;
  await apiSend('PUT', '/me/language', { language });
}

/** The "Receive mailings" setting of the signed-in person (bulk email, Phase 23). */
export const bulkEmailSettingQuery = queryOptions({
  queryKey: ['me', 'bulk-email'],
  queryFn: () => apiGet('/me/bulk-email', BulkSubscriptionSchema),
});

export async function saveBulkEmailSetting(subscribed: boolean): Promise<void> {
  await apiSend('PUT', '/me/bulk-email', { subscribed });
}
