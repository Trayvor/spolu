import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import {
  GroupInputSchema,
  GroupSchema,
  GroupSummaryListSchema,
  MemberListSchema,
  type Group,
  type GroupInput,
} from '@spolu/shared';
import { apiGet, apiSend, apiSendRaw } from '@/lib/api';

// Query keys share the `['groups']` prefix, so one invalidation refreshes the list and a group.

/** All groups, by name (admins only). */
export const groupsQuery = queryOptions({
  queryKey: ['groups'],
  queryFn: () => apiGet('/groups', GroupSummaryListSchema),
});

export const groupQuery = (id: string) =>
  queryOptions({
    queryKey: ['groups', id],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(id)}`, GroupSchema),
  });

export function createGroup(input: GroupInput): Promise<Group> {
  return apiSend('POST', '/groups', GroupInputSchema.parse(input), GroupSchema);
}

export function updateGroup(id: string, input: GroupInput): Promise<Group> {
  return apiSend(
    'PATCH',
    `/groups/${encodeURIComponent(id)}`,
    GroupInputSchema.parse(input),
    GroupSchema,
  );
}

/** Upload the (already resized) logo; the blob's type is sent as the Content-Type. */
export function uploadLogo(id: string, blob: Blob): Promise<void> {
  return apiSendRaw('PUT', `/groups/${encodeURIComponent(id)}/logo`, blob, blob.type);
}

export async function removeLogo(id: string): Promise<void> {
  await apiSend('DELETE', `/groups/${encodeURIComponent(id)}/logo`);
}

const InviteSchema = z.object({ inviteUrl: z.string() });

/** A new invite link; the old one stops working at once. */
export async function regenerateInvite(id: string): Promise<string> {
  const { inviteUrl } = await apiSend(
    'POST',
    `/groups/${encodeURIComponent(id)}/invite`,
    undefined,
    InviteSchema,
  );
  return inviteUrl;
}

export const membersQuery = (id: string) =>
  queryOptions({
    queryKey: ['groups', id, 'members'],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(id)}/members`, MemberListSchema),
  });

/** Removed members (admins only). */
export const removedMembersQuery = (id: string) =>
  queryOptions({
    queryKey: ['groups', id, 'removed'],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(id)}/members/removed`, MemberListSchema),
  });

export async function removeMember(groupId: string, userId: string): Promise<void> {
  await apiSend(
    'DELETE',
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
  );
}

export async function restoreMember(groupId: string, userId: string): Promise<void> {
  await apiSend(
    'POST',
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/restore`,
  );
}
