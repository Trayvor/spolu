import { z } from 'zod';
import { TaskPersonSchema } from '../tasks.js';
import { TicketStatusSchema } from '../tickets.js';
import { EventDateSchema, ProjectRefSchema } from './common.js';

/**
 * The timeline (Phase 33 part P4, spec §7.2, §7.3). Written by P1 so the parts share one shape;
 * P4 refines only this file.
 */

export const TIMELINE_LIMITS = {
  /** Events a page in each direction. */
  page: 15,
  /** Open tasks and open tickets under an event. */
  openRows: 5,
  /** The event sheet's and the done pile's pages. */
  itemsPage: 20,
  /** Project ids in the timeline's `project` or `exclude` list. */
  projects: 50,
} as const;

/** A comma-separated list of 1 to 50 project ids (`?project=a,b`, `?exclude=c`). */
const ProjectIdListSchema = z
  .string()
  .max(5_100)
  .transform((value) => value.split(',').filter((id) => id !== ''))
  .pipe(z.array(z.string().min(1).max(100)).min(1).max(TIMELINE_LIMITS.projects));

/** An open or done task under an event. */
export const TimelineTaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  urgent: z.boolean(),
  completedAt: z.string().nullable(),
  assignees: z.array(TaskPersonSchema),
});
export type TimelineTaskRow = z.infer<typeof TimelineTaskRowSchema>;

/** An open or resolved ticket under an event. */
export const TimelineTicketRowSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  subject: z.string().nullable(),
  status: TicketStatusSchema,
});
export type TimelineTicketRow = z.infer<typeof TimelineTicketRowSchema>;

export const TimelineEventDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  occursOn: z.string(),
  project: ProjectRefSchema,
  /** "From eGrant". */
  fromEgrant: z.boolean(),
  files: z.number().int(),
  openTasks: z.array(TimelineTaskRowSchema),
  openTaskCount: z.number().int(),
  openTickets: z.array(TimelineTicketRowSchema),
  openTicketCount: z.number().int(),
  /** Completed tasks and resolved tickets: the done pile. */
  doneCount: z.number().int(),
});
export type TimelineEventDto = z.infer<typeof TimelineEventDtoSchema>;

/**
 * `GET /api/groups/:id/timeline`. No list: all active projects. `project`: only these projects,
 * archived ones too. `exclude`: all active projects except these. Not both.
 */
export const TimelineQuerySchema = z
  .object({
    project: ProjectIdListSchema.optional(),
    exclude: ProjectIdListSchema.optional(),
    around: z.union([z.literal('today'), EventDateSchema]).default('today'),
    before: z.string().min(1).max(400).optional(),
    after: z.string().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(TIMELINE_LIMITS.page).default(TIMELINE_LIMITS.page),
  })
  .refine((q) => q.project === undefined || q.exclude === undefined, { path: ['exclude'] });
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export const TimelineResponseSchema = z.object({
  events: z.array(TimelineEventDtoSchema),
  /** Cursors for "Earlier" and "Later"; null at the ends. */
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Today in Bratislava, `YYYY-MM-DD`. */
  today: z.string(),
});
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

/** `GET /api/project-events/:id/items`: the sheet's and the done pile's lists. */
export const EventItemsQuerySchema = z.object({
  kind: z.enum(['tasks', 'tickets', 'done']),
  after: z.string().min(1).max(400).optional(),
});
export type EventItemsQuery = z.infer<typeof EventItemsQuerySchema>;

export const EventItemsPageSchema = z.object({
  tasks: z.array(TimelineTaskRowSchema),
  tickets: z.array(TimelineTicketRowSchema),
  nextCursor: z.string().nullable(),
});
export type EventItemsPage = z.infer<typeof EventItemsPageSchema>;
