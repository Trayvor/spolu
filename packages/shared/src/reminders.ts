import { z } from 'zod';
import { TaskPersonSchema } from './tasks.js';

/** What a reminder set belongs to. Phase 19 adds `'task'`. */
export type ReminderSubjectKind = 'knowledge';

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
  groupId: string;
  title: string;
  /** The reminder time (ISO). */
  at: string;
  /** Set for task subjects (Phase 19), so the task title lookup shows the current title. */
  taskId?: string;
};

/** One of a user's next reminders across groups (the Phase 20 dashboard card). */
export type UpcomingReminder = {
  id: string;
  at: string;
  title: string;
  groupId: string;
  groupName: string;
  target: { kind: 'knowledge'; itemId: string };
};
