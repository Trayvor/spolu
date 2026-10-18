import { z } from 'zod';
import { BucketLabelSchema } from './tasks.js';
import { TicketStatusSchema } from './tickets.js';

/** At most this many lines in an unseen summary; the rest is "and N more". */
export const UNSEEN_SUMMARY_LINES = 5;

/**
 * One line of "what changed since I last opened it" (2026-10-18): built from the viewer's own
 * unseen notification events of one task or ticket, one line per kind of change.
 */
export const UnseenSummaryLineSchema = z.discriminatedUnion('kind', [
  /** The ticket is new (`ticket.created`, `ticket.unassigned`). */
  z.object({ kind: z.literal('created') }),
  /** The task moved: from the first move's column to the last one's. */
  z.object({
    kind: z.literal('moved'),
    from: BucketLabelSchema.nullable(),
    to: BucketLabelSchema.nullable(),
  }),
  /** The viewer was assigned (`task.assigned`, `ticket.assigned`). */
  z.object({ kind: z.literal('assigned') }),
  /** The deadline is near: the due date the reminder was about. */
  z.object({ kind: z.literal('deadline'), dueDate: z.string() }),
  /** New messages in its chat (and thread replies), with their authors, newest first. */
  z.object({
    kind: z.literal('messages'),
    count: z.number().int(),
    authors: z.array(z.string()),
  }),
  /** The viewer was mentioned in its chat. */
  z.object({
    kind: z.literal('mentions'),
    count: z.number().int(),
    authors: z.array(z.string()),
  }),
  /** The ticket's status changed (its latest). */
  z.object({ kind: z.literal('status'), status: TicketStatusSchema }),
  /** The ticket's details changed. */
  z.object({ kind: z.literal('updated') }),
  /** Tasks were made from the ticket. */
  z.object({ kind: z.literal('tasks'), count: z.number().int() }),
  /** The ticket asks for the viewer's time. */
  z.object({ kind: z.literal('timeMissing') }),
]);
export type UnseenSummaryLine = z.infer<typeof UnseenSummaryLineSchema>;

/**
 * `GET /tasks/:id/unseen-summary`, `GET /tickets/:id/unseen-summary`: the lines, newest change
 * first, at most `UNSEEN_SUMMARY_LINES`, and how many more there are.
 */
export const UnseenSummarySchema = z.object({
  lines: z.array(UnseenSummaryLineSchema),
  more: z.number().int(),
});
export type UnseenSummary = z.infer<typeof UnseenSummarySchema>;
