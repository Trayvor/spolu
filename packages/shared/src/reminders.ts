import { z } from 'zod';
import { IdSchema } from './chat.js';
import { TaskPersonSchema } from './tasks.js';

/**
 * What a reminder set belongs to: a knowledge reminder item (Phase 17), a task (Phase 19) or a
 * finance item (Phase 32, a contract's reminders; only finance admins read or receive them).
 */
export type ReminderSubjectKind = 'knowledge' | 'task' | 'finance';

/** Unfired times per set, and `added` recipients per set (the server's `REMINDER_LIMITS`). */
export const REMINDER_PUT_LIMITS = { times: 20, recipients: 50 } as const;

const unique = (ids: string[]) => [...new Set(ids)];
const allDistinct = (values: unknown[]) => new Set(values).size === values.length;

/**
 * `PUT /api/<prefix>/:id/reminders` (subjects edited on their own, Phase 19: tasks). `times` are
 * the sender's upcoming times after the change (an `id` is an existing one); zero is valid.
 * `baseTimeIds` are the unfired time ids the sender had loaded: only those missing from `times`
 * are deleted, so a time someone else added meanwhile survives. `recipientIds` omitted means
 * "recipients unchanged".
 */
export const ReminderPutSchema = z.object({
  times: z
    .array(z.object({ id: IdSchema.optional(), at: z.iso.datetime({ offset: true }) }))
    .max(REMINDER_PUT_LIMITS.times)
    .refine((times) => allDistinct(times.map((t) => Date.parse(t.at))), {
      message: 'Duplicate time',
    })
    .refine((times) => allDistinct(times.flatMap((t) => (t.id === undefined ? [] : [t.id]))), {
      message: 'Duplicate time id',
    }),
  recipientIds: z.array(IdSchema).max(REMINDER_PUT_LIMITS.recipients).transform(unique).optional(),
  baseTimeIds: z.array(IdSchema).max(REMINDER_PUT_LIMITS.times).default([]),
});
export type ReminderPut = z.output<typeof ReminderPutSchema>;

/** How a person became a recipient: the subject's author, added by the author, or by themselves. */
export const RecipientSources = ['author', 'added', 'subscribed'] as const;
export type RecipientSource = (typeof RecipientSources)[number];

/** The times and recipients of one subject, as the reader sees them. */
export const ReminderSetDtoSchema = z.object({
  times: z.array(z.object({ id: z.string(), at: z.string(), firedAt: z.string().nullable() })),
  recipients: z.array(z.object({ user: TaskPersonSchema, source: z.enum(RecipientSources) })),
  /** The reader is a recipient. */
  subscribed: z.boolean(),
  canEdit: z.boolean(),
});
export type ReminderSetDto = z.infer<typeof ReminderSetDtoSchema>;

/** Payload of a `reminder.due` notification event. */
export type ReminderDuePayload = {
  subjectKind: ReminderSubjectKind;
  subjectId: string;
  /** Null only for a finance item of the organisation (Phase 32 E): it opens on `/finance`. */
  groupId: string | null;
  title: string;
  /** The reminder time (ISO). */
  at: string;
  /** Set for task subjects (Phase 19), so the task title lookup shows the current title. */
  taskId?: string;
  /** Set for a meeting's reminder (2026-10-17): it belongs to the `meetings` notification group. */
  meeting?: true;
  /** A finance contract's last day, `YYYY-MM-DD` (Phase 32): "ends on …" in the texts. */
  endsOn?: string;
  /** An expense's date, `YYYY-MM-DD` (Phase 32 E): "expense due on …" in the texts. */
  dueOn?: string;
  /** An admin's salary (Phase 32 E): `title` is the admin's name (and the expense's title). */
  salary?: true;
};

/** One of a user's next reminders across groups (the Phase 20 dashboard card). */
export type UpcomingReminder = {
  id: string;
  at: string;
  title: string;
  /** Null only for a finance item of the organisation (Phase 32 E); `groupName` is then ''. */
  groupId: string | null;
  groupName: string;
  target:
    | { kind: 'knowledge'; itemId: string }
    | { kind: 'task'; taskId: string }
    | { kind: 'finance'; itemId: string };
};

/** Socket events of the reminders module, to the group room after a write or a firing commits. */
export const RemindersEvents = { task: 'reminders:task' } as const;

/** A task's count of upcoming custom reminders changed (the board card's bell). */
export type TaskRemindersEvent = { groupId: string; taskId: string; upcomingReminders: number };
