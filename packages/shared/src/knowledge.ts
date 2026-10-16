import { z } from 'zod';
import { FileInfoSchema } from './files.js';
import { ReminderSetDtoSchema } from './reminders.js';
import { TaskPersonSchema } from './tasks.js';

export const KnowledgeTypes = ['note', 'file', 'link', 'reminder'] as const;
export type KnowledgeType = (typeof KnowledgeTypes)[number];

/** `public`: everyone in the group; `admins`: eGrant only. */
export const Visibilities = ['public', 'admins'] as const;
export type Visibility = (typeof Visibilities)[number];

export const KNOWLEDGE_LIMITS = {
  title: 200,
  body: 10_000,
  url: 2048,
  /** Files of a note (a file item has exactly one). */
  noteFiles: 10,
  /** Reminder times per item. */
  times: 20,
  /** Recipients a reminder's author may add. */
  recipients: 50,
  pageSize: 30,
  /** Characters of the body shown on a list row. */
  excerpt: 140,
  /** Group ids in the global list's `clients` filter. */
  clients: 200,
} as const;

/** An absolute http or https URL of at most 2048 characters (links, never `javascript:`). */
export function isHttpUrl(value: string): boolean {
  if (value.length > KNOWLEDGE_LIMITS.url) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const unique = (ids: string[]) => [...new Set(ids)];
const isoDateTime = z.iso.datetime({ offset: true });

/** The times and added recipients of a reminder item; a time with an `id` is an existing one. */
export const ReminderInputSchema = z.object({
  times: z
    .array(z.object({ id: z.string().optional(), at: isoDateTime }))
    .min(1)
    .max(KNOWLEDGE_LIMITS.times),
  recipientIds: z.array(z.string()).max(KNOWLEDGE_LIMITS.recipients).transform(unique),
});
export type ReminderInput = z.output<typeof ReminderInputSchema>;

const titleField = z.string().trim().min(1).max(KNOWLEDGE_LIMITS.title);
const bodyField = z.string().max(KNOWLEDGE_LIMITS.body);
const urlField = z.string().refine(isHttpUrl);
const visibilityField = z.enum(Visibilities);
const noFiles = z.array(z.string()).max(0).default([]);

const draftBase = z.object({
  title: titleField,
  body: bodyField.default(''),
  visibility: visibilityField.default('public'),
});

/** A new item; each type has its own fields. */
export const KnowledgeDraftSchema = z.discriminatedUnion('type', [
  draftBase.extend({
    type: z.literal('note'),
    fileIds: z.array(z.string()).max(KNOWLEDGE_LIMITS.noteFiles).default([]),
  }),
  draftBase.extend({ type: z.literal('file'), fileIds: z.array(z.string()).length(1) }),
  draftBase.extend({ type: z.literal('link'), url: urlField, fileIds: noFiles }),
  draftBase.extend({
    type: z.literal('reminder'),
    reminder: ReminderInputSchema,
    fileIds: noFiles,
  }),
]);
export type KnowledgeDraft = z.output<typeof KnowledgeDraftSchema>;

/**
 * An edit: an omitted field stays unchanged. The type cannot change (`type` is rejected), and the
 * service applies the per-type rules. `updatedAt` of the version being edited; a stale value
 * answers 409 `knowledge_changed`.
 */
export const KnowledgePatchSchema = z
  .object({
    title: titleField.optional(),
    body: bodyField.optional(),
    url: urlField.optional(),
    fileIds: z.array(z.string()).max(KNOWLEDGE_LIMITS.noteFiles).optional(),
    visibility: visibilityField.optional(),
    reminder: ReminderInputSchema.optional(),
    updatedAt: isoDateTime,
  })
  .strict();
export type KnowledgePatch = z.output<typeof KnowledgePatchSchema>;

/** A list row. */
export const KnowledgeSummarySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  type: z.enum(KnowledgeTypes),
  visibility: visibilityField,
  title: z.string(),
  /** The start of the body as plain text, at most 140 characters. */
  excerpt: z.string(),
  url: z.string().nullable(),
  /** The file of a file item. */
  file: FileInfoSchema.nullable(),
  fileCount: z.number().int(),
  nextReminderAt: z.string().nullable(),
  upcomingCount: z.number().int(),
  lastReminderAt: z.string().nullable(),
  createdBy: TaskPersonSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set in the global list only. */
  group: z.object({ id: z.string(), name: z.string(), logoUrl: z.string().nullable() }).optional(),
});
export type KnowledgeSummary = z.infer<typeof KnowledgeSummarySchema>;

export const KnowledgePageSchema = z.object({
  items: z.array(KnowledgeSummarySchema),
  nextCursor: z.string().nullable(),
});
export type KnowledgePage = z.infer<typeof KnowledgePageSchema>;

/** The detail of one item. */
export const KnowledgeItemDtoSchema = KnowledgeSummarySchema.extend({
  body: z.string(),
  files: z.array(FileInfoSchema),
  reminder: ReminderSetDtoSchema.nullable(),
  canEdit: z.boolean(),
  /** The author is a client, so the item stays public. */
  visibilityLocked: z.boolean(),
});
export type KnowledgeItemDto = z.infer<typeof KnowledgeItemDtoSchema>;

/** `GET /api/knowledge/scope`: null while client managers do not exist (Phase 18). */
export const KnowledgeScopeSchema = z.object({ managedGroupIds: z.array(z.string()).nullable() });
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;

/** Socket events pushed after a knowledge write commits. */
export const KnowledgeEvents = {
  item: 'knowledge:item',
  itemDeleted: 'knowledge:item_deleted',
} as const;

export type KnowledgeItemEvent = { item: KnowledgeSummary };
export type KnowledgeItemDeletedEvent = { groupId: string; id: string };
