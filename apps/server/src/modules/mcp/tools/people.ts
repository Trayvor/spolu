import { z } from 'zod';
import { defineTool, fromApi, idArg, type ToolDef } from './define.js';

/** Who you are, the groups (clients and the admin group), their people and the admins. */
export const peopleTools: ToolDef[] = [
  defineTool({
    name: 'whoami',
    title: 'Who am I',
    description:
      'The Help by eGrant user this connection acts as: id, name, email, role, whether they hold the finance right, and the token’s scope (read or write). Every tool reads and changes exactly what this user may in the app.',
    input: z.object({}),
    // The user as the token resolved them just now (role, finance right), and the token's scope.
    run: async ({ user, scope }) => ({ status: 200, data: { ...user, scope } }),
  }),
  defineTool({
    name: 'list_groups',
    title: 'List groups',
    description:
      'Every group: the client groups (one per client organisation, with its eGrant address) and the internal admin group "eGrant tím" (kind "admin"). Use the ids with the other tools.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/groups')),
  }),
  defineTool({
    name: 'get_group',
    title: 'Get a group',
    description: 'One group: its name, kind, eGrant address and settings.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) => fromApi(await api('GET', `/api/groups/${groupId}`)),
  }),
  defineTool({
    name: 'list_group_people',
    title: 'List a group’s people',
    description:
      'The people of a group who read it: its active, named clients and every active admin, each with isAdmin and isManager. Assignees and mentions must be its clients or its managers.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) => fromApi(await api('GET', `/api/groups/${groupId}/people`)),
  }),
  defineTool({
    name: 'list_group_members',
    title: 'List a group’s members',
    description:
      'The Members tab of a client group. `which`: "members" (clients, default), "requesters" (žiadatelia, who only see their own tickets), "invited" (not signed in yet) or "removed".',
    input: z.object({
      groupId: idArg('group'),
      which: z.enum(['members', 'requesters', 'invited', 'removed']).default('members'),
    }),
    run: async ({ api }, { groupId, which }) => {
      const path = {
        members: `/api/groups/${groupId}/members`,
        requesters: `/api/groups/${groupId}/requesters`,
        invited: `/api/groups/${groupId}/members/invited`,
        removed: `/api/groups/${groupId}/members/removed`,
      }[which];
      return fromApi(await api('GET', path));
    },
  }),
  defineTool({
    name: 'list_admins',
    title: 'List admins',
    description: 'Every active administrator (the eGrant team).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/admins')),
  }),
];
