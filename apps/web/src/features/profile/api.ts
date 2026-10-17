import { queryOptions } from '@tanstack/react-query';
import { BulkSubscriptionSchema, MeSchema, type Me } from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** Send a 6-digit code to the new address; the email changes only after `confirmEmailChange`. */
export async function requestEmailChange(newEmail: string): Promise<void> {
  await apiSend('POST', '/me/email-change', { newEmail });
}

/** Exchange the code for the new address; answers the updated profile. */
export function confirmEmailChange(newEmail: string, code: string): Promise<Me> {
  return apiSend('POST', '/me/email-change/confirm', { newEmail, code }, MeSchema);
}

/** The "Receive mailings" setting of the signed-in person (bulk email, Phase 23). */
export const bulkEmailSettingQuery = queryOptions({
  queryKey: ['me', 'bulk-email'],
  queryFn: () => apiGet('/me/bulk-email', BulkSubscriptionSchema),
});

export async function saveBulkEmailSetting(subscribed: boolean): Promise<void> {
  await apiSend('PUT', '/me/bulk-email', { subscribed });
}
