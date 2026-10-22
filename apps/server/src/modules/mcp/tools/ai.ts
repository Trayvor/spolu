import { z } from 'zod';
import { TICKET_DRAFT_INSTRUCTIONS_MAX } from '@spolu/shared';
import { defineTool, fromApi, idArg, type ToolDef } from './define.js';

/**
 * The app's AI helpers (2026-10-21). Each one only suggests: nothing is sent, created or
 * changed, so read-only tokens have them too (their routes are `read` allowlist entries). The
 * routes' own rules and AI limits apply; without AI configured they answer 503.
 */
export const aiTools: ToolDef[] = [
  defineTool({
    name: 'translate_message',
    title: 'Translate a chat message',
    description:
      'A chat message someone else wrote, translated with AI into the user’s language (their profile language), as "Preložiť" under a received message in the app: `text` and the detected source language. Not for the user’s own messages or the "eGrant tím" group (403). Changes nothing.',
    input: z.object({ messageId: idArg('message') }),
    run: async ({ api }, { messageId }) =>
      fromApi(await api('POST', `/api/messages/${messageId}/translate`)),
  }),
  defineTool({
    name: 'translate_ticket',
    title: 'Translate a ticket',
    description:
      'The text of a ticket someone else wrote, translated with AI into the user’s language. Changes nothing. Its chat messages: translate_message.',
    input: z.object({ ticketId: idArg('ticket') }),
    run: async ({ api }, { ticketId }) =>
      fromApi(await api('POST', `/api/tickets/${ticketId}/translate`)),
  }),
  defineTool({
    name: 'draft_ticket_reply',
    admin: true,
    title: 'Draft a ticket reply',
    description:
      'Managers only: an AI draft of a reply to the ticket ("Navrhnúť odpoveď"), from the ticket, its conversation, the client’s shareable knowledge and similar resolved tickets: `reply` and the `sources` it used. Optional `instructions` steer it ("shorter", "ask for the invoice"). Nothing is sent: send it with reply_to_ticket after a human read it.',
    input: z.object({
      ticketId: idArg('ticket'),
      instructions: z.string().max(TICKET_DRAFT_INSTRUCTIONS_MAX).optional(),
    }),
    run: async ({ api }, { ticketId, instructions }) =>
      fromApi(
        await api('POST', `/api/tickets/${ticketId}/ai-draft`, {
          body: instructions === undefined ? {} : { instructions },
        }),
      ),
  }),
  defineTool({
    name: 'suggest_ticket_task_split',
    title: 'Suggest tasks from a ticket',
    description:
      'AI proposals of task cards for a ticket of a client ("Rozdeliť na úlohy"): title, description, assignees, due date, urgency, link, project (`projectId`: the ticket\'s own project, else an active project of the client the text clearly refers to, else null), the ticket files that belong to each card, plus `files`. Creates nothing: create the reviewed cards with create_task_from_ticket.',
    input: z.object({ ticketId: idArg('ticket') }),
    run: async ({ api }, { ticketId }) =>
      fromApi(await api('POST', `/api/tickets/${ticketId}/task-split`)),
  }),
  defineTool({
    name: 'suggest_message_task_split',
    title: 'Suggest tasks from a chat message',
    description:
      'AI proposals of task cards for a chat message of a client’s chat (group or task chat): title, description, assignees, due date, urgency, link, project (`projectId`: an active project of the client the text clearly refers to, else null) and the message files of each card. Creates nothing: create the reviewed cards with create_task_from_message.',
    input: z.object({ messageId: idArg('message') }),
    run: async ({ api }, { messageId }) =>
      fromApi(await api('POST', `/api/messages/${messageId}/task-split`)),
  }),
];
