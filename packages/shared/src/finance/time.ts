import { z } from 'zod';
import { DaySchema, MinutesSchema } from './common.js';

/**
 * Time on done (Phase 32 part A2, spec §5): the task panel's "My time", the time dialog and the
 * dashboard's "Fill in your time" rows; since the 2026-10-17 extension also time on a resolved
 * ticket (spec §5.6). Written by A1, refined by A2 only.
 */

/** The caller's own entry on a task: `minutes` null and `requested` true = asked, not answered. */
export const TaskTimeMineSchema = z.object({
  minutes: z.number().int().nullable(),
  requested: z.boolean(),
});
export type TaskTimeMine = z.infer<typeof TaskTimeMineSchema>;

/** One admin assignee's time, for finance admins only. */
export const TaskTimeAssigneeSchema = z.object({
  userId: z.string(),
  name: z.string(),
  minutes: z.number().int().nullable(),
  requested: z.boolean(),
});
export type TaskTimeAssignee = z.infer<typeof TaskTimeAssigneeSchema>;

/**
 * `GET /api/tasks/:id/time` and the answer of `PUT /api/tasks/:id/time/me`. `mine` is null when
 * the caller is no admin assignee; `assignees` is present only for a finance admin.
 */
export const TaskTimeDtoSchema = z.object({
  mine: TaskTimeMineSchema.nullable(),
  assignees: z.array(TaskTimeAssigneeSchema).optional(),
});
export type TaskTimeDto = z.infer<typeof TaskTimeDtoSchema>;

/** `PUT /api/tasks/:id/time/me`. */
export const PutMyTaskTimeBodySchema = z.object({ minutes: MinutesSchema }).strict();
export type PutMyTaskTimeBody = z.infer<typeof PutMyTaskTimeBodySchema>;

/**
 * A ticket's time (`GET /api/tickets/:id/time`, spec §5.6): the caller's own entry (with the
 * "covered by the linked tasks" answer), the linked tasks with only the caller's own minutes on
 * them, and whether any linked task has filled time (a yes or no, never someone else's hours) —
 * the dialog then offers option (b). `assignees` only for a finance admin.
 */
export const TicketTimeMineSchema = TaskTimeMineSchema.extend({ coveredByTasks: z.boolean() });
export type TicketTimeMine = z.infer<typeof TicketTimeMineSchema>;

export const TicketTimeDtoSchema = z.object({
  mine: TicketTimeMineSchema.nullable(),
  linkedTasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      done: z.boolean(),
      /** The caller's own minutes on that task; null when they have none. */
      mine: z.number().int().nullable(),
    }),
  ),
  /** Some linked task is done and has filled time (anyone's): option (b) is offered. */
  linkedTasksLogged: z.boolean(),
  assignees: z.array(TaskTimeAssigneeSchema.extend({ coveredByTasks: z.boolean() })).optional(),
});
export type TicketTimeDto = z.infer<typeof TicketTimeDtoSchema>;

/**
 * `PUT /api/tickets/:id/time/me`: (a) minutes for the ticket itself (on top of the linked
 * tasks' hours), or (b) "the linked tasks' hours cover it" — stored as a filled entry of 0
 * minutes with `coveredByTasks`, so no request stays and nothing is added to any total.
 */
export const PutMyTicketTimeBodySchema = z.union([
  z.object({ minutes: MinutesSchema }).strict(),
  z.object({ coveredByTasks: z.literal(true) }).strict(),
]);
export type PutMyTicketTimeBody = z.infer<typeof PutMyTicketTimeBodySchema>;

/** What a time request is about: a completed task or a resolved ticket. */
export const TimeSubjectKinds = ['task', 'ticket'] as const;
export type TimeSubjectKind = (typeof TimeSubjectKinds)[number];

/**
 * One open time request of the caller (`listMyTimeRequests`): a requested task or ticket entry.
 * The home module adds the client's name; no money ever.
 */
export const TimeRequestRowSchema = z.object({
  entryId: z.string(),
  kind: z.enum(TimeSubjectKinds),
  /** Set for a task request. */
  taskId: z.string().nullable(),
  /** Set for a ticket request. */
  ticketId: z.string().nullable(),
  groupId: z.string(),
  title: z.string(),
  /** The Bratislava day of the task's first completion or the ticket's first resolution. */
  workedOn: DaySchema,
});
export type TimeRequestRow = z.infer<typeof TimeRequestRowSchema>;

/** A dashboard row: the request with its client's name. */
export const TimeRequestSchema = TimeRequestRowSchema.extend({ groupName: z.string() });
export type TimeRequest = z.infer<typeof TimeRequestSchema>;

/**
 * The move, create and update answers of the task board, and the ticket status answer on
 * resolve, gain this (false for clients).
 */
export const AskTimeSchema = z.object({ askTime: z.boolean() });
export type AskTime = z.infer<typeof AskTimeSchema>;
