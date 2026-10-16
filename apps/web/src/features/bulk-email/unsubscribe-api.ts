import { queryOptions } from '@tanstack/react-query';
import { BulkUnsubscribeInfoSchema } from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const path = (token: string) => `/bulk-email/unsubscribe/${encodeURIComponent(token)}`;

/** The language and setting behind an unsubscribe link; a 404 means the link is not valid. */
export const unsubscribeInfoQuery = (token: string) =>
  queryOptions({
    queryKey: ['bulk-unsubscribe', token],
    queryFn: () => apiGet(path(token), BulkUnsubscribeInfoSchema),
    retry: false,
    staleTime: Infinity,
  });

export async function unsubscribe(token: string): Promise<void> {
  await apiSend('POST', path(token));
}

export async function subscribeAgain(token: string): Promise<void> {
  await apiSend('POST', `/bulk-email/subscribe/${encodeURIComponent(token)}`);
}
