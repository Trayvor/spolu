import { z } from 'zod';
import { IdSchema, MENTION_RE } from './chat.js';
import { FileInfoSchema } from './files.js';
import { KnowledgeIdsSchema, LinkedKnowledgeSchema } from './knowledge-links.js';
import {
  MeetingDetailSchema,
  MeetingInputSchema,
  MeetingListInfoSchema,
  MeetingPatchSchema,
} from './meetings.js';
import { MeetingSeriesScopeSchema } from './meeting-series.js';
import { ReminderSetDtoSchema } from './reminders.js';
import { TaskPersonSchema } from './tasks.js';
import { isHttpUrl, MAX_URL_LENGTH } from './urls.js';

/**
 * Every item type. `meeting` (Phase 30): a meeting or call. The automatic file types
 * (`KnowledgeAutoFileTypes`) are files of other places, created and removed only with them,
 * read-only and never in a folder: `chat_file` ("From chat", a file of a chat message),
 * `ticket_file` ("From ticket", a file uploaded with a ticket or sent to its intake) and
 * `task_file` ("From task", a file attached to a task card; 2026-10-22).
 */
export const KnowledgeTypes = [
  'note',
  'file',
  'link',
  'reminder',
  'meeting',
  'chat_file',
  'ticket_file',
  'task_file',
] as const;
export type KnowledgeType = (typeof KnowledgeTypes)[number];

/**
 * The automatic file types (2026-10-22): nobody creates, edits, moves or deletes one by hand;
 * its author and admins may turn it into a normal file item ("Save as a file").
 */
export const KnowledgeAutoFileTypes = ['chat_file', 'ticket_file', 'task_file'] as const;
export type KnowledgeAutoFileType = (typeof KnowledgeAutoFileTypes)[number];

/** Whether `type` is an automatic file type (`KnowledgeAutoFileTypes`). */
export function isAutoFileType(type: string): type is KnowledgeAutoFileType {
  return (KnowledgeAutoFileTypes as readonly string[]).includes(type);
}

/** The types people create by hand (the "+ New" menu). */
export const KnowledgeCreatableTypes = ['note', 'file', 'link', 'reminder', 'meeting'] as const;
export type KnowledgeCreatableType = (typeof KnowledgeCreatableTypes)[number];

/**
 * The list filter's `chats` param: `all` also lists the files of the task and ticket chats;
 * `group` (the default) only the group chat's.
 */
export const KnowledgeChatsFilterSchema = z.enum(['group', 'all']);
export type KnowledgeChatsFilter = z.infer<typeof KnowledgeChatsFilterSchema>;

/** Where a chat file came from: the message and its chat, enough to link to it. */
export const KnowledgeChatSourceSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  /** The thread's root when the message is a reply. */
  parentId: z.string().nullable(),
  kind: z.enum(['group', 'task', 'ticket']),
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  ticketId: z.string().nullable(),
  ticketNumber: z.number().int().nullable(),
});
export type KnowledgeChatSource = z.infer<typeof KnowledgeChatSourceSchema>;

/**
 * Where a ticket or task file came from (2026-10-22): the ticket (`number` its #, `title` its
 * subject) or the task (`title` its title, `number` null), enough to link to it.
 */
export const KnowledgeOriginSchema = z.object({
  kind: z.enum(['ticket', 'task']),
  id: z.string(),
  number: z.number().int().nullable(),
  title: z.string().nullable(),
});
export type KnowledgeOrigin = z.infer<typeof KnowledgeOriginSchema>;

/**
 * A list filter's `type` query param: one type, a comma list (`note,link`) or repeated params.
 * Empty means every type. The result has no duplicates and follows `KnowledgeTypes` order; an
 * unknown type fails.
 */
export const KnowledgeTypeListSchema = z
  .union([z.string().max(100), z.array(z.string().max(100)).max(KnowledgeTypes.length)])
  .transform((value) =>
    (Array.isArray(value) ? value : [value]).flatMap((part) => part.split(',')).filter(Boolean),
  )
  .pipe(z.array(z.enum(KnowledgeTypes)))
  .transform((types) => KnowledgeTypes.filter((type) => types.includes(type)));

/** `public`: everyone in the group; `admins`: eGrant only. */
export const Visibilities = ['public', 'admins'] as const;
export type Visibility = (typeof Visibilities)[number];

export const KNOWLEDGE_LIMITS = {
  title: 200,
  body: 10_000,
  url: MAX_URL_LENGTH,
  /** Files of a note (a file item has exactly one). */
  noteFiles: 10,
  /** Reminder times per item not yet sent (a new item: all of its times). */
  times: 20,
  /**
   * Times one edit may send: the form sends sent times back with their ids, and the server keeps
   * the limit of 20 on the unsent ones.
   */
  timesSent: 200,
  /** Recipients a reminder's author may add. */
  recipients: 50,
  pageSize: 30,
  /**
   * Characters of the body in a list row's `excerpt` (`knowledgeExcerpt`): a row shows one line
   * of it, a card (card view) several.
   */
  excerpt: 360,
  /** Group ids in the global list's `clients` filter. */
  clients: 200,
} as const;

const FENCE_LINE = /^\s*```/;
const QUOTE_MARKS = /^(\s*>\s?)+/;
const HEADING_MARK = /^#{1,3} (?=\S)/;
const BULLET_MARK = /^\s*[-*] (?=\S)/;
const LINK = /\[([^\]\n`[]+)\]\((?:https?:|mailto:)[^)\s]*\)/g;
const PAIR_MARKS = /\*\*|~~|`/g;
/** `_x_` as the chat's italic: not inside a word, so `snake_case` keeps its underscores. */
const ITALIC = /(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu;

/**
 * The start of a knowledge body as plain text for the lists (a row shows one line, a card a few):
 * mentions as names (`nameOf`, `@?` when unknown), the chat's formatting marks dropped (headings,
 * quotes, bold, italic, strike, code, link targets; bullets become "•"), one line per non-empty
 * line, at most `max` characters (whole characters) and "…" when cut.
 */
export function knowledgeExcerpt(
  body: string,
  nameOf: (id: string) => string | undefined,
  max: number,
): string {
  const lines: string[] = [];
  for (const raw of body
    .replace(MENTION_RE, (_, id: string) => (id === 'all' ? '@all' : `@${nameOf(id) ?? '?'}`))
    .split('\n')) {
    if (FENCE_LINE.test(raw)) continue;
    const line = raw
      .replace(QUOTE_MARKS, '')
      .replace(HEADING_MARK, '')
      .replace(BULLET_MARK, '• ')
      .replace(LINK, '$1')
      .replace(PAIR_MARKS, '')
      .replace(ITALIC, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) lines.push(line);
  }
  const chars = Array.from(lines.join('\n'));
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : chars.join('');
}

const unique = (ids: string[]) => [...new Set(ids)];
const isoDateTime = z.iso.datetime({ offset: true });

const allDistinct = (values: unknown[]) => new Set(values).size === values.length;

/**
 * The times and added recipients of a reminder item; a time with an `id` is an existing one.
 * Two times may not share an instant (whatever their offsets) or an id. `maxTimes` is 20 for a
 * new item and `timesSent` for an edit, which also carries the sent times.
 */
const reminderInput = (maxTimes: number, minTimes = 1) =>
  z.object({
    times: z
      .array(z.object({ id: IdSchema.optional(), at: isoDateTime }))
      .min(minTimes)
      .max(maxTimes)
      .refine((times) => allDistinct(times.map((t) => Date.parse(t.at))), {
        message: 'Duplicate time',
      })
      .refine((times) => allDistinct(times.flatMap((t) => (t.id === undefined ? [] : [t.id]))), {
        message: 'Duplicate time id',
      }),
    recipientIds: z.array(IdSchema).max(KNOWLEDGE_LIMITS.recipients).transform(unique),
  });
export const ReminderInputSchema = reminderInput(KNOWLEDGE_LIMITS.times);
/**
 * An edit may carry no time at all: a meeting's reminder is optional (Phase 30). A reminder item
 * keeps at least one, which the service checks.
 */
export const ReminderEditSchema = reminderInput(KNOWLEDGE_LIMITS.timesSent, 0);
/** A meeting's optional reminder (Phase 30): no time means no reminder. */
export const MeetingReminderInputSchema = reminderInput(KNOWLEDGE_LIMITS.times, 0);
export type ReminderInput = z.output<typeof ReminderInputSchema>;

const titleField = z.string().trim().min(1).max(KNOWLEDGE_LIMITS.title);
const bodyField = z.string().max(KNOWLEDGE_LIMITS.body);
const urlField = z.string().trim().refine(isHttpUrl);
const visibilityField = z.enum(Visibilities);
const fileIdsField = (max: number) => z.array(IdSchema).max(max).transform(unique);
const noFiles = fileIdsField(0).default([]);

/** A folder of the item's group; null is the top level. */
const folderIdField = IdSchema.nullable();

const draftBase = z.object({
  title: titleField,
  body: bodyField.default(''),
  visibility: visibilityField.default('public'),
  folderId: folderIdField.default(null),
  /** Other items attached to the body (Phase 33 part P5); absent = none. */
  knowledgeIds: KnowledgeIdsSchema.optional(),
});

/** A new item; each type has its own fields. */
export const KnowledgeDraftSchema = z.discriminatedUnion('type', [
  draftBase.extend({
    type: z.literal('note'),
    fileIds: fileIdsField(KNOWLEDGE_LIMITS.noteFiles).default([]),
  }),
  draftBase.extend({
    type: z.literal('file'),
    fileIds: z.array(IdSchema).length(1).transform(unique),
  }),
  draftBase.extend({ type: z.literal('link'), url: urlField, fileIds: noFiles }),
  draftBase.extend({
    type: z.literal('reminder'),
    reminder: ReminderInputSchema,
    fileIds: noFiles,
  }),
  draftBase.extend({
    type: z.literal('meeting'),
    meeting: MeetingInputSchema,
    reminder: MeetingReminderInputSchema.optional(),
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
    fileIds: fileIdsField(KNOWLEDGE_LIMITS.noteFiles).optional(),
    visibility: visibilityField.optional(),
    reminder: ReminderEditSchema.optional(),
    /** Moves the item: a folder of its group, or null for the top level. */
    folderId: folderIdField.optional(),
    /** A meeting's own fields (Phase 30); only on a meeting. */
    meeting: MeetingPatchSchema.optional(),
    /** Phase 33 part P5: absent leaves the attached items; `[]` removes them. */
    knowledgeIds: KnowledgeIdsSchema.optional(),
    /**
     * A call of a recurring series (ADR 0049): `following` also applies the title, notes,
     * visibility, folder, meeting link, start and reminder to the later calls of the series.
     * Absent or `this`: only this call.
     */
    seriesScope: MeetingSeriesScopeSchema.optional(),
    updatedAt: isoDateTime,
  })
  .strict();
export type KnowledgePatch = z.output<typeof KnowledgePatchSchema>;

/**
 * `POST /api/knowledge/:id/to-file`: an automatic file (chat, ticket or task file) becomes a
 * normal file item with these fields (one way). It keeps its id, author and time, and gets its
 * own copy of the file, so the message, ticket or task keeps its attachment and deleting it no
 * longer touches the item.
 * `updatedAt` of the version seen; a stale one answers 409 `knowledge_changed`.
 */
export const KnowledgeToFileSchema = draftBase.extend({ updatedAt: isoDateTime }).strict();
export type KnowledgeToFile = z.output<typeof KnowledgeToFileSchema>;

/** A list row. */
export const KnowledgeSummarySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  type: z.enum(KnowledgeTypes),
  visibility: visibilityField,
  title: z.string(),
  /**
   * The start of the body as plain text (`knowledgeExcerpt`): its lines joined by "\n", at most
   * 360 characters plus "…".
   */
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
  /** The item's folder; null at the top level. */
  folderId: z.string().nullable(),
  /** The folders from the top level down to the item's folder; empty at the top level. */
  folderPath: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Set in the global list only. */
  group: z.object({ id: z.string(), name: z.string(), logoUrl: z.string().nullable() }).optional(),
  /** The source message of a chat file; null (or absent) for the other types. */
  chat: KnowledgeChatSourceSchema.nullable().optional(),
  /** The ticket or task of a ticket or task file; null (or absent) for the other types. */
  origin: KnowledgeOriginSchema.nullable().optional(),
  /** A meeting's date and states (Phase 30); null (or absent) for the other types. */
  meeting: MeetingListInfoSchema.nullable().optional(),
  /** Phase 34: `admin_group` for an item of the admin group "eGrant tím" (its badge). */
  source: z.literal('admin_group').optional(),
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
  /**
   * An automatic file (chat, ticket or task file) the viewer may turn into a file item ("Save as
   * a file"); absent: false.
   */
  canConvert: z.boolean().optional(),
  /** The author is a client, so the item stays public. */
  visibilityLocked: z.boolean(),
  /** A meeting's fields, transcript and summary (Phase 30); null for the other types. */
  meetingDetail: MeetingDetailSchema.nullable().optional(),
  /** Other items attached to the body (Phase 33 part P5); absent on older answers: none. */
  linkedKnowledge: LinkedKnowledgeSchema.optional(),
});
export type KnowledgeItemDto = z.infer<typeof KnowledgeItemDtoSchema>;

/** `GET /api/knowledge/scope`: null while client managers do not exist (Phase 18). */
export const KnowledgeScopeSchema = z.object({ managedGroupIds: z.array(z.string()).nullable() });
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;

export const KNOWLEDGE_FOLDER_LIMITS = {
  /** Characters of a folder name. */
  name: 100,
  /** Folders of one group. */
  perGroup: 1000,
} as const;

/** A folder of a group's knowledge base; `parentId` null is the top level. */
export const KnowledgeFolderDtoSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  visibility: visibilityField,
  updatedAt: z.string(),
});
export type KnowledgeFolderDto = z.infer<typeof KnowledgeFolderDtoSchema>;

/** `GET /api/groups/:id/knowledge/folders`: every folder the actor sees, by name. */
export const KnowledgeFolderListSchema = z.object({ folders: z.array(KnowledgeFolderDtoSchema) });
export type KnowledgeFolderList = z.infer<typeof KnowledgeFolderListSchema>;

const folderNameField = z.string().trim().min(1).max(KNOWLEDGE_FOLDER_LIMITS.name);

/** A new folder: in `parentId` (null: the top level). */
export const KnowledgeFolderDraftSchema = z.object({
  name: folderNameField,
  parentId: folderIdField.default(null),
  visibility: visibilityField.default('public'),
});
export type KnowledgeFolderDraft = z.output<typeof KnowledgeFolderDraftSchema>;

/** Rename, move (`parentId`) or change the visibility of a folder: at least one field. */
export const KnowledgeFolderPatchSchema = z
  .object({
    name: folderNameField.optional(),
    parentId: folderIdField.optional(),
    visibility: visibilityField.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' });
export type KnowledgeFolderPatch = z.output<typeof KnowledgeFolderPatchSchema>;

/** Socket events pushed after a knowledge write commits. */
export const KnowledgeEvents = {
  item: 'knowledge:item',
  itemDeleted: 'knowledge:item_deleted',
  folder: 'knowledge:folder',
  folderDeleted: 'knowledge:folder_deleted',
  /** A task made from a meeting was created, edited, moved or deleted: refetch its detail. */
  meetingTasks: 'knowledge:meeting_tasks',
} as const;

export type KnowledgeFolderEvent = { folder: KnowledgeFolderDto };
export type KnowledgeFolderDeletedEvent = { groupId: string; id: string };

export type KnowledgeItemEvent = { item: KnowledgeSummary };
export type KnowledgeItemDeletedEvent = { groupId: string; id: string };
export type KnowledgeMeetingTasksEvent = { groupId: string; id: string };
