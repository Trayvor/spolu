import { z } from 'zod';
import { TicketCreateBodySchema, TicketPatchBodySchema } from '@spolu/shared';
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
          ? await api('GET', `/api/groups/${groupId}/tickets`, { query: query(rest) })
          : await api('GET', '/api/tickets/global', {
              query: query({ ...rest, scope, clients }),
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
];
