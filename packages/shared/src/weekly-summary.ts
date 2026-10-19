import { z } from 'zod';
import { UserLanguages } from './notifications.js';

/**
 * Weekly client summaries (spec 2026-10-19): one email a week per client group, drafted by the
 * AI (or as a plain list of facts), reviewed, edited and sent by the group's manager; every
 * report is kept permanently and searchable in the archive. Its own module, so `sideEffects:
 * false` keeps it out of the web entry chunk.
 */

export const WEEKLY_SUMMARY_LIMITS = {
  item: 500,
  items: 30,
  intro: 1500,
  closing: 600,
  /** What the AI may write (sanitized on the server). */
  aiItems: 15,
  aiIntro: 600,
  aiClosing: 300,
  listPage: 50,
  archivePage: 20,
  revisions: 20,
  qMin: 2,
  qMax: 100,
} as const;

/** No `expired`: a draft never expires, only a manager's action moves it (owner, 2026-10-19). */
export const WeeklySummaryStatuses = ['preparing', 'draft', 'sending', 'sent', 'skipped'] as const;
export type WeeklySummaryStatus = (typeof WeeklySummaryStatuses)[number];
export const WeeklySummarySkipReasons = ['no_activity', 'manager'] as const;
export type WeeklySummarySkipReason = (typeof WeeklySummarySkipReasons)[number];
export const WeeklySummarySources = ['ai', 'facts'] as const;
export type WeeklySummarySource = (typeof WeeklySummarySources)[number];
export const WeeklySummaryRefKinds = ['task', 'ticket', 'event'] as const;
export type WeeklySummaryRefKind = (typeof WeeklySummaryRefKinds)[number];
export const WeeklySummarySections = ['done', 'waiting', 'upcoming'] as const;
export type WeeklySummarySection = (typeof WeeklySummarySections)[number];

/** The error codes of the module's routes, besides the shared `ErrorCodes`. */
export const WeeklySummaryErrors = {
  staleVersion: 'stale_version',
  notDraft: 'not_draft',
  refsChanged: 'refs_changed',
  noRecipients: 'no_recipients',
} as const;

const LanguageSchema = z.enum(UserLanguages);
const WeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const WeeklySummaryRefSchema = z.object({
  kind: z.enum(WeeklySummaryRefKinds),
  id: z.string().min(1).max(200),
});
export type WeeklySummaryRef = z.infer<typeof WeeklySummaryRefSchema>;

/** One bullet: `ref` ties it to a task, ticket or event of the group; a manager's own has null. */
export const WeeklySummaryItemSchema = z.object({
  id: z.uuid(),
  ref: WeeklySummaryRefSchema.nullable(),
  text: z.string().trim().min(1).max(WEEKLY_SUMMARY_LIMITS.item),
});
export type WeeklySummaryItem = z.infer<typeof WeeklySummaryItemSchema>;

const Items = z.array(WeeklySummaryItemSchema).max(WEEKLY_SUMMARY_LIMITS.items);

export const WeeklySummaryContentSchema = z.object({
  intro: z.string().max(WEEKLY_SUMMARY_LIMITS.intro),
  done: Items,
  waiting: Items,
  upcoming: Items,
  closing: z.string().max(WEEKLY_SUMMARY_LIMITS.closing),
});
export type WeeklySummaryContent = z.infer<typeof WeeklySummaryContentSchema>;

export const EMPTY_WEEKLY_CONTENT: WeeklySummaryContent = {
  intro: '',
  done: [],
  waiting: [],
  upcoming: [],
  closing: '',
};

/** The number of items of all three sections. */
export const weeklyItemCount = (c: WeeklySummaryContent): number =>
  c.done.length + c.waiting.length + c.upcoming.length;

const PersonName = z.object({ name: z.string() });

export const WeeklySummaryListItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  week: z.string(),
  status: z.enum(WeeklySummaryStatuses),
  skipReason: z.enum(WeeklySummarySkipReasons).nullable(),
  source: z.enum(WeeklySummarySources).nullable(),
  aiFailed: z.boolean(),
  itemCount: z.number().int(),
  /** Who would get it now (a draft), or who got it (frozen at Send). */
  recipientCount: z.number().int(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
  managedByMe: z.boolean(),
});
export type WeeklySummaryListItem = z.infer<typeof WeeklySummaryListItemSchema>;

export const WeeklySummaryListSchema = z.object({
  items: z.array(WeeklySummaryListItemSchema),
  nextCursor: z.string().nullable(),
  /** Drafts of earlier weeks in the admin's groups (spec §12.2): they never vanish. */
  olderDrafts: z.number().int(),
});
export type WeeklySummaryList = z.infer<typeof WeeklySummaryListSchema>;

export const WeeklySummaryDtoSchema = WeeklySummaryListItemSchema.extend({
  windowStart: z.string(),
  windowEnd: z.string(),
  language: LanguageSchema,
  content: WeeklySummaryContentSchema,
  version: z.number().int(),
  canEdit: z.boolean(),
  revisionCount: z.number().int(),
  /** Names and languages only: recipients' emails never reach the web. */
  recipients: z.array(z.object({ name: z.string(), language: LanguageSchema })),
  /** App links of the items' refs, by item id, for the editor. */
  refs: z.record(
    z.string(),
    z.object({ kind: z.enum(WeeklySummaryRefKinds), title: z.string(), url: z.string() }),
  ),
  /** Who saved it last and who sent it (names only). */
  updatedBy: PersonName.nullable(),
  sentBy: PersonName.nullable(),
  /** The group is deactivated: the draft can be read, not sent. */
  groupDeactivated: z.boolean(),
});
export type WeeklySummaryDto = z.infer<typeof WeeklySummaryDtoSchema>;

export const WeeklySummaryListQuerySchema = z.object({
  week: WeekSchema.optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['review', 'sent', 'all']).default('review'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(WEEKLY_SUMMARY_LIMITS.listPage).default(50),
});
export type WeeklySummaryListQuery = z.infer<typeof WeeklySummaryListQuerySchema>;

export const WeeklySummaryPatchSchema = z.object({
  version: z.number().int().min(1),
  content: WeeklySummaryContentSchema,
  language: LanguageSchema.optional(),
});
export type WeeklySummaryPatch = z.infer<typeof WeeklySummaryPatchSchema>;

export const WeeklySummaryVersionSchema = z.object({
  version: z.number().int().min(1),
  language: LanguageSchema.optional(),
});
export type WeeklySummaryVersionBody = z.infer<typeof WeeklySummaryVersionSchema>;

export const WeeklySummaryPreviewSchema = z.object({ language: LanguageSchema });
export const WeeklySummaryPreviewResultSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type WeeklySummaryPreviewResult = z.infer<typeof WeeklySummaryPreviewResultSchema>;

export const WeeklySummarySettingsSchema = z.object({ enabled: z.boolean() });
export const WeeklySummaryGroupSettingSchema = z.object({
  enabled: z.boolean(),
  canEdit: z.boolean(),
});
export type WeeklySummaryGroupSetting = z.infer<typeof WeeklySummaryGroupSettingSchema>;

export const MyWeeklySummarySchema = z.object({ subscribed: z.boolean() });
export const MyWeeklySummaryGroupsSchema = z.object({
  groups: z.array(
    z.object({
      groupId: z.string(),
      name: z.string(),
      subscribed: z.boolean(),
      enabled: z.boolean(),
    }),
  ),
});
export type MyWeeklySummaryGroups = z.infer<typeof MyWeeklySummaryGroupsSchema>;
export const WeeklySummaryReminderSchema = z.object({ remind: z.boolean() });

/** The public unsubscribe page (`/weekly-summary/unsubscribe/<token>`). */
export const WeeklySummaryUnsubscribeInfoSchema = z.object({
  groupName: z.string(),
  language: LanguageSchema,
  subscribed: z.boolean(),
});
export type WeeklySummaryUnsubscribeInfo = z.infer<typeof WeeklySummaryUnsubscribeInfoSchema>;

export const WeeklySummaryEvents = { changed: 'weekly-summary:changed' } as const;
export const WeeklySummaryChangedSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  week: z.string(),
  status: z.enum(WeeklySummaryStatuses),
  version: z.number().int(),
});
export type WeeklySummaryChanged = z.infer<typeof WeeklySummaryChangedSchema>;

/** The archive (spec §7.3): every report but `preparing`, newest window first. */
export const WeeklySummaryArchiveQuerySchema = z
  .object({
    groupId: z.string().min(1).max(200).optional(),
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    q: z.string().trim().min(WEEKLY_SUMMARY_LIMITS.qMin).max(WEEKLY_SUMMARY_LIMITS.qMax).optional(),
    status: z.enum(['sent', 'unsent', 'all']).default('all'),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(WEEKLY_SUMMARY_LIMITS.archivePage),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['from'] });
export type WeeklySummaryArchiveQuery = z.infer<typeof WeeklySummaryArchiveQuerySchema>;

export const WeeklySummaryArchiveItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  groupDeactivated: z.boolean(),
  week: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  status: z.enum(WeeklySummaryStatuses),
  skipReason: z.enum(WeeklySummarySkipReasons).nullable(),
  sentAt: z.string().nullable(),
  sentBy: PersonName.nullable(),
  content: WeeklySummaryContentSchema,
});
export type WeeklySummaryArchiveItem = z.infer<typeof WeeklySummaryArchiveItemSchema>;

export const WeeklySummaryArchiveSchema = z.object({
  items: z.array(WeeklySummaryArchiveItemSchema),
  nextCursor: z.string().nullable(),
});
export type WeeklySummaryArchive = z.infer<typeof WeeklySummaryArchiveSchema>;

export const WeeklySummaryRevisionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  language: LanguageSchema,
  source: z.enum(WeeklySummarySources),
  createdBy: PersonName.nullable(),
  createdAt: z.string(),
  content: WeeklySummaryContentSchema,
});
export type WeeklySummaryRevision = z.infer<typeof WeeklySummaryRevisionSchema>;
export const WeeklySummaryRevisionsSchema = z.object({
  items: z.array(WeeklySummaryRevisionSchema),
});

/** The client groups an admin may pick in the archive (deactivated ones marked). */
export const WeeklySummaryGroupOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  deactivated: z.boolean(),
});
export type WeeklySummaryGroupOption = z.infer<typeof WeeklySummaryGroupOptionSchema>;
