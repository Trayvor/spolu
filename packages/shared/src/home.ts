import { z } from 'zod';
import { BucketKindSchema, TaskDtoSchema, TaskPersonSchema } from './tasks.js';

/**
 * Phase 20: the admin home (dashboard, client sidebar) and the global task board. Its own module,
 * so `sideEffects: false` keeps it out of the web entry chunk.
 */

export const HOME_LIMITS = {
  tasks: 20,
  mentions: 20,
  mentionCap: 100,
  mentionDays: 90,
  reminders: 10,
  columnPage: 50,
  completedDays: 30,
  excerpt: 80,
} as const;

/** One client row of the admin sidebar, already ordered by the server. */
export const SidebarClientSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  hasLogo: z.boolean(),
  updatedAt: z.string(),
  /** The viewer manages this client. */
  managed: z.boolean(),
  /** Unread group chat messages (the Chat tab count). */
  unread: z.number().int(),
  /** The viewer's open tasks in this client (not in Completed). */
  assigned: z.number().int(),
});
export type SidebarClient = z.infer<typeof SidebarClientSchema>;
export const SidebarSchema = z.array(SidebarClientSchema);

export const AssignedTaskSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  title: z.string(),
  urgent: z.boolean(),
  dueDate: z.string().nullable(),
  bucketKind: BucketKindSchema,
});
export type AssignedTask = z.infer<typeof AssignedTaskSchema>;
export const AssignedTasksSchema = z.object({
  total: z.number().int(),
  urgent: z.number().int(),
  items: z.array(AssignedTaskSchema),
});
export type AssignedTasks = z.infer<typeof AssignedTasksSchema>;

export const MentionItemSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
  /** Set when the message is in a task chat. */
  taskId: z.string().nullable(),
  /** Set when the message is a thread reply: the thread's root. */
  parentId: z.string().nullable(),
  groupId: z.string(),
  groupName: z.string(),
  authorName: z.string(),
  excerpt: z.string(),
  createdAt: z.string(),
});
export type MentionItem = z.infer<typeof MentionItemSchema>;
export const MentionsSchema = z.object({
  /** Capped at `HOME_LIMITS.mentionCap`. */
  total: z.number().int(),
  items: z.array(MentionItemSchema),
});
export type Mentions = z.infer<typeof MentionsSchema>;

/**
 * One upcoming reminder time on the dashboard. The spec's `UpcomingReminder` contract, named so it
 * does not collide with the reminders module's own `UpcomingReminder` (which is assignable to it).
 */
export const HomeReminderSchema = z.object({
  id: z.string(),
  at: z.string(),
  title: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('knowledge'), itemId: z.string() }),
    z.object({ kind: z.literal('task'), taskId: z.string() }),
  ]),
});
export type HomeReminder = z.infer<typeof HomeReminderSchema>;
export const HomeRemindersSchema = z.union([
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    /** Reminder times in the next 7 days (capped at 100). */
    nextWeek: z.number().int(),
    items: z.array(HomeReminderSchema),
    /** The reminder source failed; the card shows its error line. */
    error: z.boolean().optional(),
  }),
]);
export type HomeReminders = z.infer<typeof HomeRemindersSchema>;

/** The global board's columns: by bucket kind, every custom bucket in `other`. */
export const BoardColumnKinds = [
  'todo',
  'other',
  'egrant_review',
  'client_review',
  'done',
] as const;
export type BoardColumnKind = (typeof BoardColumnKinds)[number];

export const GlobalTaskDtoSchema = TaskDtoSchema.extend({
  groupName: z.string(),
  groupHasLogo: z.boolean(),
  groupUpdatedAt: z.string(),
  bucketKind: BucketKindSchema,
  /** Custom buckets only. */
  bucketName: z.string().nullable(),
});
export type GlobalTaskDto = z.infer<typeof GlobalTaskDtoSchema>;

export const GlobalColumnSchema = z.object({
  kind: z.enum(BoardColumnKinds),
  total: z.number().int(),
  items: z.array(GlobalTaskDtoSchema),
  /** Cursor for "Show 50 more", or null on the last page. */
  next: z.string().nullable(),
});
export type GlobalColumn = z.infer<typeof GlobalColumnSchema>;

export const GlobalBoardSchema = z.object({
  columns: z.array(GlobalColumnSchema),
  /** The distinct assignees of the tasks in the client scope, by name (for the assignee menu). */
  people: z.array(TaskPersonSchema),
});
export type GlobalBoard = z.infer<typeof GlobalBoardSchema>;

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(idPattern);

export const DueFilters = ['overdue', 'week', 'none'] as const;
export type DueFilter = (typeof DueFilters)[number];

/** The global board's query string. Every field is optional; see the Phase 20 spec. */
export const GlobalBoardFilterSchema = z
  .object({
    /** Comma-separated group ids (at most 200), or `all` for every client. */
    clients: z
      .union([
        z.literal('all'),
        z
          .string()
          .transform((value) => value.split(','))
          .pipe(z.array(id).min(1).max(200)),
      ])
      .optional(),
    /** `me`, `anyone` (default), `none` (unassigned) or a person id. */
    assignee: z.union([z.enum(['me', 'anyone', 'none']), id]).default('anyone'),
    urgent: z
      .literal('1')
      .transform(() => true)
      .optional(),
    due: z.enum(DueFilters).optional(),
    /** Title search; shorter than 2 characters is ignored. */
    q: z
      .string()
      .trim()
      .max(100)
      .transform((value) => (value.length >= 2 ? value : undefined))
      .optional(),
    completed: z
      .literal('1')
      .transform(() => true)
      .optional(),
    column: z.enum(BoardColumnKinds).optional(),
    // The cursor carries the client's name (up to 100 characters, more bytes in base64url).
    after: z.string().min(1).max(1000).optional(),
  })
  .refine((v) => (v.column === undefined) === (v.after === undefined), {
    message: 'column and after go together',
  });
export type GlobalBoardFilter = z.output<typeof GlobalBoardFilterSchema>;

export const MineCountSchema = z.object({ open: z.number().int() });
export type MineCount = z.infer<typeof MineCountSchema>;

/** Sent to the `admins` room after a chat or task write in any group. */
export const AdminEvents = { activity: 'admin:activity' } as const;
export type AdminActivityEvent = { groupId: string; kind: 'chat' | 'task' };
