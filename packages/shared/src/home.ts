import { z } from 'zod';
import { BucketKindSchema, TaskDtoSchema, TaskPersonSchema } from './tasks.js';
import { TicketStatusSchema } from './tickets.js';
import { TimeRequestSchema } from './finance/time.js';
import { UnseenMarkSchema } from './unseen-mark.js';
import { ProjectFilterValueSchema } from './projects/filters.js';

/**
 * Phase 20: the admin home (dashboard, client sidebar) and the global task board. Its own module,
 * so `sideEffects: false` keeps it out of the web entry chunk.
 */

export const HOME_LIMITS = {
  tasks: 20,
  /** Phase 32: the "Fill in your time" rows on My tasks. */
  timeRequests: 20,
  tickets: 20,
  mentions: 20,
  mentionCap: 100,
  mentionDays: 90,
  reminders: 10,
  columnPage: 50,
  completedDays: 30,
  /** Custom bucket columns on the global board; the rest fold into Other steps. */
  customColumns: 12,
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
  /** `internal`: the admin group, first in its own section (Phase 34); `client` otherwise. */
  section: z.enum(['internal', 'client']).default('client'),
  /** Unread group chat messages (the Chat tab count). */
  unread: z.number().int(),
  /** Tasks of this client with an unseen change for the viewer (2026-10-17, completed too). */
  unseenTasks: z.number().int(),
  /** Tickets of this client with an unseen change for the viewer. */
  unseenTickets: z.number().int(),
  /**
   * The row's place among all groups by name in the database's order (2026-10-18, 1 = first).
   * A client patching a row puts it back by this rank, never by comparing names in the browser's
   * locale, which orders "Č" or ties differently.
   */
  nameRank: z.number().int(),
});
export type SidebarClient = z.infer<typeof SidebarClientSchema>;
export const SidebarSchema = z.array(SidebarClientSchema);

/** At most this many groups in one `GET /me/home/sidebar?groups=` (2026-10-18). */
export const SIDEBAR_PATCH_MAX = 50;

/**
 * `GET /me/home/sidebar` query (2026-10-18): without `groups`, every row; with `groups` (comma
 * separated ids, 1 to `SIDEBAR_PATCH_MAX`), only those rows, so a client patches the rows an
 * `admin:activity` named instead of reloading the whole list.
 */
export const SidebarQuerySchema = z.object({
  groups: z
    .string()
    .transform((v) => v.split(','))
    .pipe(
      z
        .array(z.string().regex(/^[\w-]{1,64}$/))
        .min(1)
        .max(SIDEBAR_PATCH_MAX),
    )
    .optional(),
});

export const AssignedTaskSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  title: z.string(),
  urgent: z.boolean(),
  dueDate: z.string().nullable(),
  bucketKind: BucketKindSchema,
  /** The task has a change the viewer has not seen yet (2026-10-17): how it is marked (2026-10-18). */
  unseen: UnseenMarkSchema.nullable(),
});
export type AssignedTask = z.infer<typeof AssignedTaskSchema>;
export const AssignedTasksSchema = z.object({
  total: z.number().int(),
  urgent: z.number().int(),
  items: z.array(AssignedTaskSchema),
  /**
   * Phase 32: the viewer's own open time requests (tasks and tickets), oldest first, at most
   * `HOME_LIMITS.timeRequests`; shown above the tasks whatever the notification settings.
   */
  timeRequests: z.array(TimeRequestSchema).default([]),
  /** Every open time request of the viewer ("N without time"). */
  timeRequestCount: z.number().int().default(0),
});
export type AssignedTasks = z.infer<typeof AssignedTasksSchema>;

/**
 * One active ticket on the dashboard's Tickets card: a ticket the viewer is a riešiteľ of, a
 * ticket without a riešiteľ of a client whose tickets the viewer watches, or a ticket without a
 * client. `groupId` null: without client; `hasAssignee` false: nobody is its riešiteľ yet.
 */
export const HomeTicketSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  subject: z.string().nullable(),
  /** The first characters of the text, for a ticket without a subject. */
  excerpt: z.string().nullable(),
  status: TicketStatusSchema,
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  hasAssignee: z.boolean(),
  /** The ticket has a change the viewer has not seen yet (2026-10-17): how it is marked (2026-10-18). */
  unseen: UnseenMarkSchema.nullable(),
});
export type HomeTicket = z.infer<typeof HomeTicketSchema>;
export const HomeTicketsSchema = z.object({
  /**
   * Active tickets (New, In progress): mine as a riešiteľ, those without a riešiteľ of the
   * clients I watch, and those without a client.
   */
  total: z.number().int(),
  /** Of those, in the New state. */
  fresh: z.number().int(),
  /** Of those, without a riešiteľ. */
  noAssignee: z.number().int(),
  items: z.array(HomeTicketSchema),
});
export type HomeTickets = z.infer<typeof HomeTicketsSchema>;

/**
 * The header's counts for admins (2026-10-17): the tasks and the tickets with a change the viewer
 * has not seen yet (a ticket without a client counts for every admin until they open it).
 */
export const NavCountsSchema = z.object({
  tasks: z.number().int(),
  tickets: z.number().int(),
});
export type NavCounts = z.infer<typeof NavCountsSchema>;

export const MentionItemSchema = z.object({
  messageId: z.string(),
  channelId: z.string(),
  /** Set when the message is in a task chat. */
  taskId: z.string().nullable(),
  /** Set when the message is in a ticket chat (Phase 21): the link opens `/tickets/<id>`. */
  ticketId: z.string().nullable(),
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
  /** Null only for a finance item of the organisation (Phase 32 E); `groupName` is then ''. */
  groupId: z.string().nullable(),
  groupName: z.string(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('knowledge'), itemId: z.string() }),
    z.object({ kind: z.literal('task'), taskId: z.string() }),
    // Phase 32: a finance item's reminder, listed only for its (finance admin) recipients.
    z.object({ kind: z.literal('finance'), itemId: z.string() }),
    // F15: a project event's reminder; it opens the event on the client's Prehľad tab.
    z.object({ kind: z.literal('event'), eventId: z.string() }),
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

/**
 * The global board's fixed columns, by bucket kind. Custom buckets get columns of their own
 * (`custom:<key>`, see `GlobalColumnSchema`); `other` holds the custom buckets folded beyond
 * `HOME_LIMITS.customColumns` and appears only then.
 */
export const BoardColumnKinds = [
  'todo',
  'other',
  'egrant_review',
  'client_review',
  'done',
] as const;
export type BoardColumnKind = (typeof BoardColumnKinds)[number];

/** A column of custom buckets, merged by name: `custom:` and the name's key. */
export const CUSTOM_COLUMN_PREFIX = 'custom:';
/** A column id: a fixed kind, or `custom:<key>` (the key is at most 60 characters). */
export const GlobalColumnIdSchema = z.union([
  z.enum(BoardColumnKinds),
  z.string().startsWith(CUSTOM_COLUMN_PREFIX).min(8).max(80),
]);
export type GlobalColumnId = z.infer<typeof GlobalColumnIdSchema>;

export const GlobalTaskDtoSchema = TaskDtoSchema.extend({
  groupName: z.string(),
  groupHasLogo: z.boolean(),
  groupUpdatedAt: z.string(),
  bucketKind: BucketKindSchema,
  /** Custom buckets only. */
  bucketName: z.string().nullable(),
  /** The task has a change the viewer has not seen yet (2026-10-17): how it is marked (2026-10-18). */
  unseen: UnseenMarkSchema.nullable(),
});
export type GlobalTaskDto = z.infer<typeof GlobalTaskDtoSchema>;

export const GlobalColumnSchema = z.object({
  /** `todo`, `other`… or `custom:<key>`; what `column` takes for "Show 50 more". */
  id: z.string(),
  kind: z.enum([...BoardColumnKinds, 'custom']),
  /** Custom columns only: the most common spelling of the merged buckets' name. */
  name: z.string().nullable(),
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
    /** Only the tasks the viewer created or is an assignee of. */
    mine: z
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
    column: GlobalColumnIdSchema.optional(),
    // The cursor carries the client's name (up to 100 characters, more bytes in base64url).
    after: z.string().min(1).max(1000).optional(),
    /** Phase 33 part P2: `<id>|none`, only with exactly one client in `clients`. */
    project: ProjectFilterValueSchema.optional(),
  })
  .refine((v) => (v.column === undefined) === (v.after === undefined), {
    message: 'column and after go together',
  });
export type GlobalBoardFilter = z.output<typeof GlobalBoardFilterSchema>;

/** Sent to the `admins` room after a chat or task write in any group. */
export const AdminEvents = { activity: 'admin:activity' } as const;
export type AdminActivityEvent = { groupId: string; kind: 'chat' | 'task' };
