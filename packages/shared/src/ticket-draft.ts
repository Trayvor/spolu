import { z } from 'zod';

// "Navrhnúť odpoveď" (2026-10-19): an admin asks the AI for a draft reply in a ticket's chat. A
// module of its own, so the web bundles these schemas with the lazy dialog only. See
// docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md.

/** The admin's optional instructions for the AI, at most this many characters. */
export const TICKET_DRAFT_INSTRUCTIONS_MAX = 1000;

/** The longest reply the server returns (a longer one is cut at a paragraph). */
export const TICKET_DRAFT_REPLY_MAX = 6000;

/** `POST /api/tickets/:id/ai-draft`. */
export const TicketDraftRequestSchema = z.object({
  instructions: z.string().max(TICKET_DRAFT_INSTRUCTIONS_MAX).optional().default(''),
});
export type TicketDraftRequest = z.input<typeof TicketDraftRequestSchema>;

/** One source the draft used: a shareable knowledge item or a similar resolved ticket. */
export const TicketDraftSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('knowledge'),
    id: z.string(),
    type: z.enum(['note', 'file', 'link']),
    title: z.string(),
    /** An admin-group item shown to the client ("Spoločné"). */
    fromAdminGroup: z.boolean(),
  }),
  z.object({
    kind: z.literal('ticket'),
    id: z.string(),
    number: z.number().int(),
    subject: z.string().nullable(),
  }),
]);
export type TicketDraftSource = z.infer<typeof TicketDraftSourceSchema>;

/** The draft: nothing is stored or sent; the admin inserts it into the composer. */
export const TicketDraftSchema = z.object({
  reply: z.string(),
  sources: z.array(TicketDraftSourceSchema),
});
export type TicketDraft = z.infer<typeof TicketDraftSchema>;
