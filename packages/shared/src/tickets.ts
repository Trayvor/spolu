import { z } from 'zod';
import { MessageTaskLinkSchema } from './chat.js';
import { FileInfoSchema } from './files.js';
import { isHttpUrl } from './urls.js';

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

// Standard alphabet with padding, no whitespace: the length check makes the padding correct.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The decoded length of strict base64, without decoding it. */
export function base64DecodedSize(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** A file sent whole to the intake. The name loses any path; the type is sniffed from the bytes. */
const intakeFile = z.object({
  name: z
    .string()
    .transform((v) => (v.split(/[\\/]/).pop() ?? '').trim())
    .pipe(z.string().min(1).max(TICKET_LIMITS.intakeFileName)),
  content_base64: z
    .string()
    .min(1)
    .refine((v) => v.length % 4 === 0 && BASE64.test(v), { message: 'not strict base64' }),
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
 * phone); a client creates in `groupId` (one of their groups) and is the initiator themselves,
 * so the server ignores their `requester*` fields.
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
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });
export type TicketPatchBody = z.infer<typeof TicketPatchBodySchema>;

/** `PUT /api/tickets/:id/group` (admins): assign or move the ticket's client. */
export const TicketGroupBodySchema = z.object({ groupId: z.string().min(1).max(100) });

export const TicketRequesterSchema = z.object({
  /** The initiator's account, when there is one (null: only name and email are known). */
  userId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

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
}).extend({
  requesterName: z.string().nullable(),
  /** The first words of the body, for a ticket without a subject. */
  excerpt: z.string().nullable(),
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
  cursor: z.string().max(200).optional(),
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
} as const;
export type TicketEventPayload = { ticketId: string; groupId: string | null };
