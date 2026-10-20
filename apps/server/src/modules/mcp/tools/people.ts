import { z } from 'zod';
import { defineTool, fromApi, idArg, type ToolDef } from './define.js';

const GROUPS_PAGE = 200;
const ADMINS_PAGE = 200;

type GroupRow = {
  id: string;
  name: string;
  kind: string;
  memberCount: number;
  managers?: Array<{ name: string }>;
  managedByMe: boolean;
};

type AdminRow = { name: string; email: string };

/** Lower case without diacritics, for the name filter. */
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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
      'The clients, called groups in these tools (one per client organisation; the app says Clients) and the internal admin group "eGrant tím" (kind "admin"), by name, each with its member count and managers. Filter by a name fragment `q` or `mine` (the groups the user manages); paged by `offset` (200 a page, `nextOffset` in the answer). Use the ids with the other tools.',
    input: z.object({
      q: z.string().max(100).optional(),
      mine: z.boolean().optional(),
      offset: z.number().int().min(0).optional(),
    }),
    run: async ({ api }, { q, mine, offset = 0 }) => {
      const res = await api('GET', '/api/groups');
      if (res.status !== 200 || !Array.isArray(res.body)) return fromApi(res);
      const needle = q === undefined ? '' : fold(q);
      const all = (res.body as GroupRow[])
        .filter((g) => (needle === '' || fold(g.name).includes(needle)) && (!mine || g.managedByMe))
        .map((g) => ({
          id: g.id,
          name: g.name,
          kind: g.kind,
          memberCount: g.memberCount,
          managers: (g.managers ?? []).map((m) => m.name),
          managedByMe: g.managedByMe,
        }));
      const page = all.slice(offset, offset + GROUPS_PAGE);
      const next = offset + GROUPS_PAGE;
      return {
        status: 200,
        data: { total: all.length, groups: page, nextOffset: next < all.length ? next : null },
      };
    },
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
      'The people of a group who read it: its active, named clients and every active admin, each with isAdmin and isManager. Mentions must be its clients or its managers; so must task assignees, except that an admin user also assigns any active admin.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) => fromApi(await api('GET', `/api/groups/${groupId}/people`)),
  }),
  defineTool({
    name: 'list_group_members',
    title: 'List a group’s members',
    description:
      'The Managers tab of a client (called Members in these tools; they are the client’s own people). `which`: "members" (clients, default), "requesters" (žiadatelia, who only see their own tickets), "invited" (not signed in yet) or "removed".',
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
    description:
      'The active administrators (the eGrant team), the superadmin first, then by name: id, name, email, role, and `substitution` (who substitutes them now and until when, or null). Filter by a name or email fragment `q`; paged by `offset` (200 a page, `nextOffset` in the answer).',
    input: z.object({
      q: z.string().max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    // Paged here: the route answers every admin at once, which could pass the text cap and be cut.
    run: async ({ api }, { q, offset = 0 }) => {
      const res = await api('GET', '/api/admins');
      if (res.status !== 200 || !Array.isArray(res.body)) return fromApi(res);
      const needle = q === undefined ? '' : fold(q);
      const all = (res.body as AdminRow[]).filter(
        (a) => needle === '' || fold(a.name).includes(needle) || fold(a.email).includes(needle),
      );
      const page = all.slice(offset, offset + ADMINS_PAGE);
      const next = offset + ADMINS_PAGE;
      return {
        status: 200,
        data: { total: all.length, admins: page, nextOffset: next < all.length ? next : null },
      };
    },
  }),
];
