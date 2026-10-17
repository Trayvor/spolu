import { z } from 'zod';
import { TaskPersonSchema } from '../tasks.js';
import { TicketStatusSchema } from '../tickets.js';
import { EventRefSchema, ProjectRefSchema } from './common.js';

/**
 * The overview's active cards (Phase 33 part P4, spec §7.4). Written by P1; P4 refines it.
 */

export const ACTIVE_CARD_ROWS = 8;

export const ActiveTicketRowSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  subject: z.string().nullable(),
  status: TicketStatusSchema,
  createdAt: z.string(),
  /** I am one of its riešitelia. */
  mine: z.boolean(),
  project: ProjectRefSchema.nullable(),
  event: EventRefSchema.nullable(),
});
export type ActiveTicketRow = z.infer<typeof ActiveTicketRowSchema>;

export const ActiveTaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  urgent: z.boolean(),
  assignees: z.array(TaskPersonSchema),
  /** I am one of its assignees. */
  mine: z.boolean(),
  project: ProjectRefSchema.nullable(),
  event: EventRefSchema.nullable(),
});
export type ActiveTaskRow = z.infer<typeof ActiveTaskRowSchema>;

/** `GET /api/groups/:id/overview/active`. */
export const ActiveCardsSchema = z.object({
  tickets: z.object({
    rows: z.array(ActiveTicketRowSchema),
    total: z.number().int(),
    mine: z.number().int(),
  }),
  tasks: z.object({
    rows: z.array(ActiveTaskRowSchema),
    total: z.number().int(),
    mine: z.number().int(),
    urgent: z.number().int(),
  }),
});
export type ActiveCards = z.infer<typeof ActiveCardsSchema>;
