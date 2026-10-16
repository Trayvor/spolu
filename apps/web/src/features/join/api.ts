import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { JoinInfoSchema } from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** Name and logo flag of the group behind an invite link; a 404 means the link is not valid. */
export const joinInfoQuery = (token: string) =>
  queryOptions({
    queryKey: ['join', token],
    queryFn: () => apiGet(`/join/${encodeURIComponent(token)}`, JoinInfoSchema),
    retry: false,
  });

/** `version` (the group's `updatedAt`) busts the browser cache when the logo changes. */
export const joinLogoUrl = (token: string, version: string) =>
  `/api/join/${encodeURIComponent(token)}/logo?v=${encodeURIComponent(version)}`;

/** Register the email for the group. The server answers the same for known and unknown emails. */
export async function joinGroup(token: string, email: string): Promise<void> {
  await apiSend('POST', `/join/${encodeURIComponent(token)}`, { email });
}

/** A signed-in client joins the group at once; answers the group's id. */
export async function acceptInvite(token: string): Promise<string> {
  const res = await apiSend(
    'POST',
    `/join/${encodeURIComponent(token)}/accept`,
    {},
    z.object({ groupId: z.string() }),
  );
  return res.groupId;
}
