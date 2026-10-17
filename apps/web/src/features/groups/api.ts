import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AdminGroupInputSchema,
  GroupInputSchema,
  GroupPersonListSchema,
  GroupSchema,
  GroupManagersResponseSchema,
  GroupSummaryListSchema,
  InviteMemberBodySchema,
  InviteMemberResponseSchema,
  ManagersResponseSchema,
  MemberListSchema,
  isClientGroup,
  type Group,
  type GroupInput,
  type GroupSummary,
  type GroupManagersResponse,
  type InviteMemberBody,
  type InviteMemberResponse,
  type ManagersResponse,
} from '@spolu/shared';
import { apiGet, apiSend, apiSendRaw } from '@/lib/api';

// Query keys share the `['groups']` prefix, so one invalidation refreshes the list and a group.

/** All groups, by name (admins only). */
export const groupsQuery = queryOptions({
  queryKey: ['groups'],
  queryFn: () => apiGet('/groups', GroupSummaryListSchema),
});

/**
 * `select` for client pickers and audiences (tickets, bulk email): every group but the admin
 * group, which holds no tickets and has no clients (Phase 34).
 */
export const onlyClientGroups = (groups: GroupSummary[]): GroupSummary[] =>
  groups.filter(isClientGroup);

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

/** Renames the admin group (Phase 34): its name only, it has no eGrant URL. */
export function updateAdminGroup(id: string, name: string): Promise<Group> {
  return apiSend(
    'PATCH',
    `/groups/${encodeURIComponent(id)}`,
    AdminGroupInputSchema.parse({ name }),
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

/** The group's requesters (`ziadatel` members, Phase 21); `removed` for the admins' list. */
export const requestersQuery = (id: string, removed = false) =>
  queryOptions({
    queryKey: ['groups', id, 'requesters', removed ? 'removed' : 'active'],
    queryFn: () =>
      apiGet(
        `/groups/${encodeURIComponent(id)}/requesters${removed ? '/removed' : ''}`,
        MemberListSchema,
      ),
  });

/** Removed members (admins only). */
export const removedMembersQuery = (id: string) =>
  queryOptions({
    queryKey: ['groups', id, 'removed'],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(id)}/members/removed`, MemberListSchema),
  });

/** People invited by email who have not signed in yet ("Pozvaný"; admins only). */
export const invitedMembersQuery = (id: string) =>
  queryOptions({
    queryKey: ['groups', id, 'invited'],
    queryFn: () => apiGet(`/groups/${encodeURIComponent(id)}/members/invited`, MemberListSchema),
  });

/** Add a person by email (admins only); the same email again resends the invitation. */
export function inviteMember(
  groupId: string,
  body: InviteMemberBody,
): Promise<InviteMemberResponse> {
  return apiSend(
    'POST',
    `/groups/${encodeURIComponent(groupId)}/members`,
    InviteMemberBodySchema.parse(body),
    InviteMemberResponseSchema,
  );
}

/** Cancel the invitation of a person who has not signed in yet. */
export async function cancelInvite(groupId: string, userId: string): Promise<void> {
  await apiSend(
    'DELETE',
    `/groups/${encodeURIComponent(groupId)}/members/invited/${encodeURIComponent(userId)}`,
  );
}

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

/** People of a group (members and admins) for mentions and assignees. Refetched with `['groups']`. */
export const groupPeopleQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['groups', groupId, 'people'],
    enabled: !!groupId,
    queryFn: () => apiGet(`/groups/${encodeURIComponent(groupId)}/people`, GroupPersonListSchema),
  });

/** Make the signed-in admin a manager of the group (idempotent); answers the managers and the admin's mode there. */
export function becomeManager(groupId: string): Promise<ManagersResponse> {
  return apiSend(
    'PUT',
    `/groups/${encodeURIComponent(groupId)}/managers/me`,
    undefined,
    ManagersResponseSchema,
  );
}

/** Stop managing the group (idempotent). */
export function stopManaging(groupId: string): Promise<ManagersResponse> {
  return apiSend(
    'DELETE',
    `/groups/${encodeURIComponent(groupId)}/managers/me`,
    undefined,
    ManagersResponseSchema,
  );
}

const managerUrl = (groupId: string, userId: string) =>
  `/groups/${encodeURIComponent(groupId)}/managers/${encodeURIComponent(userId)}`;

/** Make an active admin a manager of the group (admins only, idempotent); answers the managers. */
export function setManager(groupId: string, userId: string): Promise<GroupManagersResponse> {
  return apiSend('PUT', managerUrl(groupId, userId), undefined, GroupManagersResponseSchema);
}

/** Stop an admin managing the group (admins only, idempotent). */
export function unsetManager(groupId: string, userId: string): Promise<GroupManagersResponse> {
  return apiSend('DELETE', managerUrl(groupId, userId), undefined, GroupManagersResponseSchema);
}
