import { z } from 'zod';
import {
  TicketAreaRulesBodySchema,
  TicketCreateBodySchema,
  TicketGroupBodySchema,
  TicketPatchBodySchema,
  TicketProjectBodySchema,
  TicketRatingValues,
} from '@spolu/shared';
import {
  cursorArg,
  defineTool,
  fromApi,
  idArg,
  idOf,
  omit,
  query,
  type ToolDef,
} from './define.js';

/** `askTime` (ask the admin for their time) is about finance: never in an MCP answer. */
const noTime = omit(['askTime']);

const listFilters = {
  status: z
    .enum(['open', 'resolved', 'all'])
    .optional()
    .describe('"open" (new and in progress, default), "resolved" or "all"'),
  area: z.string().max(200).optional(),
  assignee: z.enum(['me', 'none']).optional().describe('"me" or "none" (no riešiteľ)'),
  q: z.string().max(100).optional().describe('A ticket number (123 or #123) or subject text'),
  after: cursorArg,
};

/** The list routes' query: the tools' `after` is the routes' `cursor`. */
const listQuery = ({ after, ...rest }: Record<string, unknown>) =>
  query({ ...rest, cursor: after });

/** Support tickets: lists, one ticket, create, change, assign. Replies: reply_to_ticket. */
export const ticketTools: ToolDef[] = [
  defineTool({
    name: 'list_tickets',
    title: 'List tickets',
    description:
      'Tickets of one client (`groupId`), or across clients without it (admins): there `scope` "mine" (the clients the user watches, default), "all", "none" (tickets without a client) or `clients` (comma-separated group ids). Paged with `after` from `nextCursor`.',
    input: z.object({
      groupId: idArg('group').optional(),
      scope: z.enum(['mine', 'all', 'none']).optional(),
      clients: z.string().max(10_000).optional(),
      ...listFilters,
    }),
    run: async ({ api }, { groupId, scope, clients, ...rest }) =>
      fromApi(
        groupId
          ? await api('GET', `/api/groups/${groupId}/tickets`, { query: listQuery(rest) })
          : await api('GET', '/api/tickets/global', {
              query: listQuery({ ...rest, scope, clients }),
            }),
      ),
  }),
  defineTool({
    name: 'get_ticket',
    title: 'Get a ticket',
    description:
      'One ticket: number, status, subject, text, area, programme, due date, the initiator, its client, riešitelia (assignees), linked tasks, project and event. Its conversation: get_chat_channel with ticketId, then list_messages.',
    input: z.object({ ticketId: idArg('ticket') }),
    run: async ({ api }, { ticketId }) => fromApi(await api('GET', `/api/tickets/${ticketId}`)),
  }),
  defineTool({
    name: 'list_ticket_assignee_candidates',
    title: 'List possible riešitelia',
    description: 'Who can be made a riešiteľ (assignee) of the ticket.',
    input: z.object({ ticketId: idArg('ticket') }),
    run: async ({ api }, { ticketId }) =>
      fromApi(await api('GET', `/api/tickets/${ticketId}/assignee-candidates`)),
  }),
  defineTool({
    name: 'create_ticket',
    title: 'Create a ticket',
    description:
      'Creates a ticket for a client (`ticket.groupId`) as the user; an admin names the initiator (`requesterEmail`, `requesterName`, `requesterPhone`). Needs a subject, text or area. Watchers are notified as in the app.',
    input: z.object({ ticket: TicketCreateBodySchema }),
    write: true,
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/tickets', { body: raw.ticket });
      return { ...fromApi(res, noTime), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    name: 'update_ticket',
    admin: true,
    title: 'Update a ticket',
    description:
      'Changes a ticket (admins): `status` ("new", "in_progress", "resolved"), `subject`, `body`, `area`, `programme`, `dueDate`, `url`, `knowledgeIds`; only the fields given. The initiator and watchers are told as in the app.',
    input: z.object({ ticketId: idArg('ticket'), changes: TicketPatchBodySchema }),
    write: true,
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId }, raw) =>
      fromApi(await api('PATCH', `/api/tickets/${ticketId}`, { body: raw.changes }), noTime),
  }),
  defineTool({
    name: 'set_ticket_assignee',
    title: 'Assign or unassign a ticket',
    description:
      'Makes a person a riešiteľ (assignee) of the ticket (`assigned: true`) or removes them (`false`). Candidates: list_ticket_assignee_candidates.',
    input: z.object({ ticketId: idArg('ticket'), userId: idArg('person'), assigned: z.boolean() }),
    write: true,
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId, userId, assigned }) =>
      fromApi(
        await api(assigned ? 'PUT' : 'DELETE', `/api/tickets/${ticketId}/assignees/${userId}`),
      ),
  }),
  defineTool({
    name: 'list_ticket_areas',
    admin: true,
    title: 'List automatic riešitelia by area',
    description:
      'Admins: a client\'s (`groupId`) table of question area → admin. A new ticket of the client whose area matches a row (case, spaces, diacritics and a leading "zend." ignored) gets that admin as a riešiteľ.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/ticket-areas`)),
  }),
  defineTool({
    name: 'set_ticket_areas',
    admin: true,
    title: 'Set automatic riešitelia by area',
    description:
      "Admins: replaces a client's whole table of question area → admin with `rules` (`area`, `userId` of an active admin: list_admins); `[]` empties it. eGrant's next sync may replace it again.",
    input: z.object({ groupId: idArg('group'), rules: TicketAreaRulesBodySchema.shape.rules }),
    write: true,
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId }, raw) =>
      fromApi(
        await api('PUT', `/api/groups/${groupId}/ticket-areas`, { body: { rules: raw.rules } }),
      ),
  }),
  defineTool({
    name: 'list_my_tickets',
    title: 'List my tickets',
    description:
      'The tickets the user is the initiator of, in the clients they are still a member of (the "My tickets" list), with the filters of list_tickets. Paged with `after` from `nextCursor`.',
    input: z.object(listFilters),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/tickets/mine', { query: listQuery(args) })),
  }),
  defineTool({
    name: 'move_ticket_to_group',
    admin: true,
    title: 'Move a ticket to another client',
    description:
      'Managers: gives the ticket to another client (`groupId`), or a client to a ticket without one. The initiator may be told by email; the new client’s automatic riešiteľ applies while nobody handles it. A ticket with linked tasks cannot move (409 has_tasks).',
    input: z.object({ ticketId: idArg('ticket'), ...TicketGroupBodySchema.shape }),
    write: true,
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId, groupId }) =>
      fromApi(await api('PUT', `/api/tickets/${ticketId}/group`, { body: { groupId } })),
  }),
  defineTool({
    name: 'set_ticket_project',
    title: 'Set a ticket’s project',
    description:
      'Links the ticket to a project of its client (`projectId`, list_projects) and optionally one of its events (`eventId`); `projectId: null` clears both. Notifies nobody.',
    input: z.object({ ticketId: idArg('ticket'), ...TicketProjectBodySchema.shape }),
    write: true,
    target: ({ ticketId }) => ticketId,
    run: async ({ api }, { ticketId, projectId, eventId }) =>
      fromApi(
        await api('PUT', `/api/tickets/${ticketId}/project`, { body: { projectId, eventId } }),
      ),
  }),
  defineTool({
    name: 'get_ticket_ratings_summary',
    admin: true,
    title: 'Get the ticket ratings summary',
    description:
      'Managers: how initiators rated resolved tickets (👍 "up" / 👎 "down") over the last `days` (30, 90 or 365; default 30), for one client (`groupId`) or all. Rating a ticket is not a tool.',
    input: z.object({
      days: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
      groupId: idArg('group').optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/tickets/ratings/summary', { query: query(args) })),
  }),
  defineTool({
    name: 'list_ticket_ratings',
    admin: true,
    title: 'List ticket ratings',
    description:
      'Managers: the ratings of resolved tickets, newest first, with the ticket, the rater and their comment; filters `days` (30, 90, 365), `groupId`, `value` ("up", "down"). Paged with `cursor` from `nextCursor`.',
    input: z.object({
      days: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
      groupId: idArg('group').optional(),
      value: z.enum(TicketRatingValues).optional(),
      cursor: z.string().min(1).max(300).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/tickets/ratings', { query: query(args) })),
  }),
  defineTool({
    name: 'get_ticket_watch',
    title: 'Get whether I watch a client’s tickets',
    description:
      'Whether the user is told about every new ticket and change of a client (`groupId`): `watching`.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/ticket-watch`)),
  }),
  defineTool({
    name: 'set_ticket_watch',
    title: 'Watch a client’s tickets',
    description:
      'Starts (`watching: true`) or stops watching a client’s tickets for the user: whether they are notified about its new tickets and changes.',
    input: z.object({ groupId: idArg('group'), watching: z.boolean() }),
    write: true,
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId, watching }) =>
      fromApi(await api('PUT', `/api/groups/${groupId}/ticket-watch`, { body: { watching } })),
  }),
];
