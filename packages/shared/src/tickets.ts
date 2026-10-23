import { z } from 'zod';
import { MessageTaskLinkSchema } from './chat.js';
import { FileInfoSchema, isStrictBase64 } from './files.js';
import { KnowledgeIdsSchema, LinkedKnowledgeSchema } from './knowledge-links.js';
import { EventRefSchema, ProjectRefSchema } from './projects/common.js';
import { projectFilterFields } from './projects/filters.js';
import { EgrantProjectIdField } from './projects/intake.js';
import { isHttpUrl } from './urls.js';
import { UnseenMarkSchema } from './unseen-mark.js';

/** Phase 21. New → In progress → Resolved; an admin may set any of them at any time. */
export const TicketStatuses = ['new', 'in_progress', 'resolved'] as const;
export type TicketStatus = (typeof TicketStatuses)[number];
export const TicketStatusSchema = z.enum(TicketStatuses);

/** `api`: sent by eGrant to the intake API; `manual`: created in Spolu by an admin or a client. */
export type TicketSource = 'api' | 'manual';

export const TICKET_LIMITS = {
  subject: 300,
  area: 200,
  programme: 200,
  name: 200,
  email: 254,
  phone: 50,
  body: 20_000,
  /** Files uploaded in the manual form. */
  files: 20,
  pageSize: 50,
  /** Group ids in the global list's `clients` filter. */
  clients: 200,
  /** The intake's idempotency key. */
  requestId: 100,
  /** Files sent as base64 to the intake: count, name length and decoded sizes. */
  intakeFiles: 10,
  intakeFileName: 200,
  intakeFileBytes: 10 * 1024 * 1024,
  intakeTotalBytes: 20 * 1024 * 1024,
  /** The intake's JSON body (base64 adds a third); every other route keeps 1 MiB. */
  intakeBodyBytes: 28 * 1024 * 1024,
} as const;

const isCalendarDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** A trimmed text of at most `max` characters; empty or blank means "not given" (null). */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const httpUrl = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || isHttpUrl(v), { message: 'not an http(s) URL' })
  .nullish()
  .transform((v) => v ?? null);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.email().max(TICKET_LIMITS.email).nullable())
  .nullish()
  .transform((v) => v ?? null);

const dueDate = z
  .string()
  .transform((v) => (v.trim() === '' ? null : v.trim()))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isCalendarDate(v)), {
    message: 'not a YYYY-MM-DD date',
  })
  .nullish()
  .transform((v) => v ?? null);

/** A file sent whole to the intake. The name loses any path; the type is sniffed from the bytes. */
const intakeFile = z.object({
  name: z
    .string()
    .transform((v) => (v.split(/[\\/]/).pop() ?? '').trim())
    .pipe(z.string().min(1).max(TICKET_LIMITS.intakeFileName)),
  content_base64: z.string().min(1).refine(isStrictBase64, { message: 'not strict base64' }),
  /** Informational only. */
  content_type: z
    .string()
    .max(255)
    .nullish()
    .transform((v) => v ?? null),
});
export type TicketIntakeFile = z.infer<typeof intakeFile>;

/** The content of a ticket, whoever sends it. */
const ticketContent = {
  area: text(TICKET_LIMITS.area),
  subject: text(TICKET_LIMITS.subject),
  programme: text(TICKET_LIMITS.programme),
  body: text(TICKET_LIMITS.body),
  dueDate,
  url: httpUrl,
};

const hasContent = (t: { subject: string | null; body: string | null; area: string | null }) =>
  t.subject !== null || t.body !== null || t.area !== null;

/**
 * The body eGrant sends to `POST /api/tickets/intake`. Every field is optional, but a ticket
 * needs at least a subject, a body or an area. Unknown fields are ignored.
 */
export const TicketIntakeBodySchema = z
  .object({
    requester_name: text(TICKET_LIMITS.name),
    email,
    phone: text(TICKET_LIMITS.phone),
    area: ticketContent.area,
    subject: ticketContent.subject,
    programme: ticketContent.programme,
    body: ticketContent.body,
    files: z
      .array(intakeFile)
      .max(TICKET_LIMITS.intakeFiles)
      .nullish()
      .transform((v) => v ?? []),
    due_date: ticketContent.dueDate,
    url: ticketContent.url,
    instance_url: text(2048),
    /**
     * eGrant's own id for this request. A repeat with the same id answers the first ticket and
     * creates nothing, so eGrant may retry safely.
     */
    request_id: z
      .string()
      .trim()
      .min(1)
      .max(TICKET_LIMITS.requestId)
      .nullish()
      .transform((v) => v ?? null),
    /** eGrant's id of the project (Phase 33 part P3); empty or missing = no project. */
    project_id: EgrantProjectIdField,
  })
  .refine(hasContent, { message: 'subject, body or area is required' });
export type TicketIntakeBody = z.infer<typeof TicketIntakeBodySchema>;

/**
 * The field names of failed checks as the intake answers them (`files[3].content_base64`);
 * `body` for a check of the whole body.
 */
export function intakeFieldNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const name = (path: readonly PropertyKey[]) =>
    path
      .map((key, i) => (typeof key === 'number' ? `[${key}]` : `${i > 0 ? '.' : ''}${String(key)}`))
      .join('') || 'body';
  return [...new Set(issues.map((i) => name(i.path)))];
}

export const TicketIntakeResponseSchema = z.object({ id: z.string(), number: z.number().int() });
export type TicketIntakeResponse = z.infer<typeof TicketIntakeResponseSchema>;

/**
 * `POST /api/tickets`. An admin sets `groupId` and the initiator (`requesterEmail`, name,
 * phone). A manager (client) creates in `groupId` (one of their groups) and is the initiator
 * themselves, unless they name another person with `requesterEmail` (a ticket on behalf of
 * someone, 2026-10-23). A ziadatel cannot create.
 */
export const TicketCreateBodySchema = z
  .object({
    groupId: z.string().min(1).max(100),
    requesterEmail: email,
    requesterName: text(TICKET_LIMITS.name),
    requesterPhone: text(TICKET_LIMITS.phone),
    ...ticketContent,
    fileIds: z
      .array(z.string())
      .max(TICKET_LIMITS.files)
      .nullish()
      .transform((v) => [...new Set(v ?? [])]),
    /** The project and event (Phase 33 part P2; optional, absent = none). */
    projectId: z.string().min(1).max(100).nullable().optional(),
    eventId: z.string().min(1).max(100).nullable().optional(),
    /** Knowledge attached to the text (Phase 33 part P5); absent = none. */
    knowledgeIds: KnowledgeIdsSchema.optional(),
  })
  .refine(hasContent, { message: 'subject, body or area is required' });
export type TicketCreateBody = z.infer<typeof TicketCreateBodySchema>;

/** `PATCH /api/tickets/:id` (admins): the fields sent change; `null` clears one. */
export const TicketPatchBodySchema = z
  .object({
    status: TicketStatusSchema,
    area: ticketContent.area,
    subject: ticketContent.subject,
    programme: ticketContent.programme,
    body: ticketContent.body,
    dueDate: ticketContent.dueDate,
    url: ticketContent.url,
    /** Knowledge attached to the text (Phase 33 part P5); `[]` removes it. */
    knowledgeIds: KnowledgeIdsSchema,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });
export type TicketPatchBody = z.infer<typeof TicketPatchBodySchema>;

/** `PUT /api/tickets/:id/group` (admins): assign or move the ticket's client. */
export const TicketGroupBodySchema = z.object({ groupId: z.string().min(1).max(100) });

export const TicketRequesterSchema = z.object({
  /**
   * The initiator's account, when there is one (null: only name and email are known). Sent only
   * to admins and to the initiator themself; null for every other reader (2026-10-23).
   */
  userId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

/**
 * Ticket rating (2026-10-19): the initiator rates a resolved ticket 👍/👎 with an optional comment,
 * changeable for `editDays` after `resolved_at`. Only admins see every rating and comment.
 */
export const TICKET_RATING_LIMITS = { comment: 1000, editDays: 14, pageSize: 50 } as const;
export const TicketRatingValues = ['up', 'down'] as const;
export type TicketRatingValue = (typeof TicketRatingValues)[number];

/** `PUT /api/tickets/:id/rating` (the initiator). */
export const TicketRatingBodySchema = z.object({
  value: z.enum(TicketRatingValues),
  /** Absent: keep the stored comment; null or blank: clear it; else trimmed and stored. */
  comment: z
    .string()
    .max(TICKET_RATING_LIMITS.comment * 2) // raw, before the trim
    .transform((v) => v.trim())
    .pipe(z.string().max(TICKET_RATING_LIMITS.comment))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
export type TicketRatingBody = z.infer<typeof TicketRatingBodySchema>;

export const TicketRatingSchema = z.object({
  value: z.enum(TicketRatingValues),
  comment: z.string().nullable(),
  /** When the value or comment last changed. */
  ratedAt: z.string(),
});
export type TicketRating = z.infer<typeof TicketRatingSchema>;

/** A rating with its rater, as admins see it on the ticket. */
export const TicketRatingWithRaterSchema = TicketRatingSchema.extend({
  userId: z.string(),
  name: z.string().nullable(),
});
export type TicketRatingWithRater = z.infer<typeof TicketRatingWithRaterSchema>;

/** The viewer's own rating and whether they may rate now (every reader gets it). */
export const TicketRatingViewSchema = z.object({
  /** The viewer's own rating; null for anyone but its rater. */
  mine: TicketRatingSchema.nullable(),
  canRate: z.boolean(),
  /** Until when the rating can be set or changed; null unless `canRate`. */
  editableUntil: z.string().nullable(),
});
export type TicketRatingView = z.infer<typeof TicketRatingViewSchema>;

/** `GET /api/tickets/ratings` and `/summary` (admins). */
export const TicketRatingQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(30), z.literal(90), z.literal(365)]))
    .default(30),
  groupId: z.string().min(1).max(100).optional(),
  value: z.enum(TicketRatingValues).optional(),
  cursor: z.string().max(300).optional(),
});
export type TicketRatingQuery = z.infer<typeof TicketRatingQuerySchema>;
export type TicketRatingDays = TicketRatingQuery['days'];

/**
 * The totals of a period: `up` and `down` ratings changed in it; `resolved` tickets resolved in it
 * that have an initiator account, and `rated` those of them with a rating. The web computes shares.
 */
export const TicketRatingSummarySchema = z.object({
  days: z.number().int(),
  up: z.number().int(),
  down: z.number().int(),
  resolved: z.number().int(),
  rated: z.number().int(),
});
export type TicketRatingSummary = z.infer<typeof TicketRatingSummarySchema>;

export const TicketRatingListItemSchema = z.object({
  ticketId: z.string(),
  number: z.number().int(),
  subject: z.string().nullable(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  raterId: z.string(),
  raterName: z.string().nullable(),
  value: z.enum(TicketRatingValues),
  comment: z.string().nullable(),
  ratedAt: z.string(),
});
export type TicketRatingListItem = z.infer<typeof TicketRatingListItemSchema>;

export const TicketRatingListSchema = z.object({
  items: z.array(TicketRatingListItemSchema),
  nextCursor: z.string().nullable(),
});
export type TicketRatingList = z.infer<typeof TicketRatingListSchema>;

/** A person on a ticket: a riešiteľ (assignee) or a candidate. */
export const TicketPersonSchema = z.object({ id: z.string(), name: z.string() });
export type TicketPerson = z.infer<typeof TicketPersonSchema>;

export const TicketDtoSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  status: TicketStatusSchema,
  source: z.enum(['api', 'manual']),
  requester: TicketRequesterSchema,
  area: z.string().nullable(),
  subject: z.string().nullable(),
  programme: z.string().nullable(),
  body: z.string().nullable(),
  dueDate: z.string().nullable(),
  url: z.string().nullable(),
  instanceUrl: z.string().nullable(),
  /** Files uploaded in the manual form or sent to the intake (`ticket_attachments`). */
  files: z.array(FileInfoSchema),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** Tasks made from the ticket (part 21.5). */
  taskCount: z.number().int(),
  /**
   * The tasks made from the ticket, oldest first, for the people who use the group's board
   * (admins and the group's clients); null for a ziadatel, who sees only `taskCount`.
   */
  tasks: z.array(MessageTaskLinkSchema).nullable(),
  /** The ticket's chat; null until the chat exists (part 21.3) or while it has no client. */
  channelId: z.string().nullable(),
  /** The ticket's riešitelia (assignees), by name. */
  assignees: z.array(TicketPersonSchema),
  /** Whether the viewer may add and remove riešitelia (admins, and the group's clients). */
  canAssign: z.boolean(),
  /**
   * The ticket's project and event (Phase 33); null until part P2 sets them. A žiadateľ gets the
   * project's name only (no colour) and never the event.
   */
  project: ProjectRefSchema.nullable(),
  event: EventRefSchema.nullable(),
  /** Knowledge attached to the text (Phase 33 part P5); a moved ticket's show as unavailable. */
  linkedKnowledge: LinkedKnowledgeSchema,
  /**
   * The eGrant link (Phase 33 part P3), for admins and the group's clients only (a žiadateľ gets
   * null and false): the raw `project_id` eGrant sent, whether the ticket waits for that project
   * (it has not arrived in the ticket's client yet), whether its project has pending changes
   * from eGrant, and whether its project is archived (the "archived project" hint).
   */
  egrantProjectId: z.string().nullable(),
  waitingForProject: z.boolean(),
  egrantChanges: z.boolean(),
  projectArchived: z.boolean(),
  /** The viewer's own rating and whether they may rate now (2026-10-19). */
  rating: TicketRatingViewSchema,
  /** Every rating with its rater and comment: admins only; null for everyone else. */
  ratings: z.array(TicketRatingWithRaterSchema).nullable(),
});
export type TicketDto = z.infer<typeof TicketDtoSchema>;

export const TicketListItemSchema = TicketDtoSchema.pick({
  id: true,
  number: true,
  groupId: true,
  groupName: true,
  status: true,
  area: true,
  subject: true,
  dueDate: true,
  createdAt: true,
  assignees: true,
  project: true,
  event: true,
}).extend({
  requesterName: z.string().nullable(),
  /** The first words of the body, for a ticket without a subject. */
  excerpt: z.string().nullable(),
  /** The ticket has a change the viewer has not seen yet (2026-10-17): how it is marked (2026-10-18). */
  unseen: UnseenMarkSchema.nullable(),
  /** Its project has pending changes from eGrant (part P3); false for a žiadateľ. */
  egrantChanges: z.boolean(),
});
export type TicketListItem = z.infer<typeof TicketListItemSchema>;

export const TicketListResponseSchema = z.object({
  items: z.array(TicketListItemSchema),
  nextCursor: z.string().nullable(),
});
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;

/**
 * Query of the ticket lists. `status`: `open` (New and In progress, the default), `resolved`
 * or `all`. Only the global list reads `scope` and `clients`: `scope=mine` (default) is the
 * clients the admin manages, `all` every client, `none` the tickets without a client; `clients`
 * (comma list) picks clients and wins over `scope`.
 */
export const TicketListQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  area: z.string().trim().max(TICKET_LIMITS.area).optional(),
  /** Riešiteľ: `me` (I am one of them) or `none` (the ticket has none); absent = anyone. */
  assignee: z.enum(['me', 'none']).optional(),
  scope: z.enum(['mine', 'all', 'none']).default('mine'),
  clients: z
    .string()
    .max(10_000)
    .transform((v) => [...new Set(v.split(',').filter(Boolean))])
    .pipe(z.array(z.string().max(100)).max(TICKET_LIMITS.clients))
    .optional(),
  /**
   * Picker search (Phase 34): `123` or `#123` is the ticket number, anything else (2 characters
   * or more) a fragment of the subject or the start of the body.
   */
  q: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === '' || v.length >= 2 || /^\d$/.test(v))
    .optional(),
  cursor: z.string().max(200).optional(),
  /**
   * Phase 33 part P2: `project=<id>|none`, `event=<id>|none` (an event needs a project). The
   * global list takes `project` only with exactly one client in `clients`, never `event`.
   */
  ...projectFilterFields,
  /**
   * `pending`: only tickets whose project has pending changes from eGrant (Phase 33 part P3).
   * For admins and the group's clients; anyone else gets 400 `invalid_filter`.
   */
  egrant: z.enum(['pending']).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuerySchema>;

/**
 * Who can be a riešiteľ of a ticket (`GET /api/tickets/:id/assignee-candidates`): every active
 * admin and the ticket's client's clients, by name; only admins for a ticket without a client.
 */
export const TicketCandidateSchema = TicketPersonSchema.extend({ isAdmin: z.boolean() });
export type TicketCandidate = z.infer<typeof TicketCandidateSchema>;
export const TicketCandidateListSchema = z.array(TicketCandidateSchema);

/**
 * "Watch tickets" of one client group for the signed-in user (`GET`/`PUT
 * /api/groups/:id/ticket-watch`): on, they hear about the group's new tickets.
 */
export const TicketWatchSchema = z.object({ watching: z.boolean() });
export type TicketWatch = z.infer<typeof TicketWatchSchema>;

/**
 * Socket events of tickets (Phase 21). The payload is only `{ ticketId, groupId }` (`groupId`:
 * the group the event is about, null for a ticket without client): the web refetches what it
 * shows, so an event never carries more than its room may read.
 */
export const TicketEvents = {
  created: 'ticket:created',
  updated: 'ticket:updated',
  /** The ticket left this group (moved to another client). */
  moved: 'ticket:moved',
  /** A rating was set or changed (2026-10-19): to the admins' room and the rater's room only. */
  rated: 'ticket:rated',
} as const;
export type TicketEventPayload = { ticketId: string; groupId: string | null };
