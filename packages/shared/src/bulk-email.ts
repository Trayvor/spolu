import { z } from 'zod';
import { isHttpUrl, MAX_URL_LENGTH } from './urls.js';

/** Phase 23 — bulk email. Limits pinned by the spec (§2, §3). */
export const BULK_LIMITS = {
  blocks: 50,
  heading: 200,
  text: 5000,
  alt: 200,
  buttonLabel: 60,
  name: 200,
  subject: 200,
  preheader: 200,
  /** Ids in each audience list. */
  audienceIds: 500,
  /** A client-made block id. */
  blockId: 100,
  pageSize: 50,
  /** Uploaded images: bytes and the width the browser shrinks to. */
  imageBytes: 2 * 1024 * 1024,
  imageWidth: 1200,
} as const;

export const BulkCampaignStatuses = ['draft', 'sending', 'sent', 'cancelled'] as const;
export type BulkCampaignStatus = (typeof BulkCampaignStatuses)[number];
export const BulkCampaignStatusSchema = z.enum(BulkCampaignStatuses);

export const BulkRecipientStatuses = [
  'queued',
  'sending',
  'sent',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type BulkRecipientStatus = (typeof BulkRecipientStatuses)[number];
export const BulkRecipientStatusSchema = z.enum(BulkRecipientStatuses);

/** How a person's bulk email setting last changed; no row means subscribed. */
export const BulkSubscriptionSources = ['link', 'one_click', 'profile', 'provider'] as const;
export type BulkSubscriptionSource = (typeof BulkSubscriptionSources)[number];

/** Image types the builder accepts and the public image route serves. */
export const BulkImageMimes = ['image/png', 'image/jpeg'] as const;
export type BulkImageMime = (typeof BulkImageMimes)[number];

export const BulkAlignSchema = z.enum(['left', 'center']);
export type BulkAlign = z.infer<typeof BulkAlignSchema>;

/** An absolute http(s) URL of at most `MAX_URL_LENGTH` characters; never `javascript:`. */
const httpUrl = z
  .string()
  .trim()
  .refine((v) => isHttpUrl(v), { message: 'not an http(s) URL' });

/** A button may also write an email: `mailto:` with a non-empty address part. */
const isMailto = (v: string): boolean =>
  v.length <= MAX_URL_LENGTH && /^mailto:[^\s]+$/i.test(v) && v.toLowerCase() !== 'mailto:';

const buttonUrl = z
  .string()
  .trim()
  .refine((v) => isHttpUrl(v) || isMailto(v), { message: 'not an http(s) or mailto: URL' });

const blockId = z.string().min(1).max(BULK_LIMITS.blockId);

export const BulkBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: blockId,
    type: z.literal('heading'),
    text: z.string().max(BULK_LIMITS.heading),
    align: BulkAlignSchema,
  }),
  z.object({
    id: blockId,
    type: z.literal('text'),
    text: z.string().max(BULK_LIMITS.text),
    align: BulkAlignSchema,
  }),
  z.object({
    id: blockId,
    type: z.literal('image'),
    imageId: z.string().min(1).max(100),
    alt: z.string().trim().min(1).max(BULK_LIMITS.alt),
    href: httpUrl.optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal('button'),
    label: z.string().max(BULK_LIMITS.buttonLabel),
    url: buttonUrl,
    align: BulkAlignSchema,
  }),
  z.object({ id: blockId, type: z.literal('divider') }),
  z.object({ id: blockId, type: z.literal('logo'), align: BulkAlignSchema }),
]);
export type BulkBlock = z.infer<typeof BulkBlockSchema>;
export type BulkBlockType = BulkBlock['type'];

export const BulkAudienceRoleSchema = z.enum(['client', 'ziadatel', 'admin']);
export type BulkAudienceRole = z.infer<typeof BulkAudienceRoleSchema>;

const idList = z.array(z.string().min(1).max(100)).max(BULK_LIMITS.audienceIds).default([]);

/**
 * Who gets a campaign (spec §2). Empty `groupIds` and `managerIds` = every group; `roles`
 * picks the people in that scope (admins ignore the scope); `includeUserIds` are always added
 * and `excludeUserIds` always removed.
 */
export const BulkAudienceSchema = z.object({
  groupIds: idList,
  managerIds: idList,
  roles: z.array(BulkAudienceRoleSchema).max(3).default([]),
  includeUserIds: idList,
  excludeUserIds: idList,
});
export type BulkAudience = z.infer<typeof BulkAudienceSchema>;

/** `PUT /api/bulk-email/campaigns/:id`: a draft save with the `version` read last. */
export const BulkCampaignDraftSchema = z.object({
  name: z.string().trim().min(1).max(BULK_LIMITS.name),
  subject: z.string().trim().max(BULK_LIMITS.subject),
  preheader: z.string().trim().max(BULK_LIMITS.preheader),
  blocks: z.array(BulkBlockSchema).max(BULK_LIMITS.blocks),
  audience: BulkAudienceSchema,
  version: z.number().int().min(1),
});
export type BulkCampaignDraft = z.infer<typeof BulkCampaignDraftSchema>;

/** Recipient rows by status, plus people unsubscribed through this campaign's link. */
export type BulkCampaignCounts = Record<BulkRecipientStatus, number> & { unsubscribed: number };

/** A campaign as the API returns it; dates are ISO strings. */
export type BulkCampaignDto = {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  blocks: BulkBlock[];
  audience: BulkAudience;
  status: BulkCampaignStatus;
  version: number;
  /** The From address used, set when sending starts. */
  sender: string | null;
  recipientCount: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  sentBy: string | null;
  createdAt: string;
  updatedAt: string;
  sendStartedAt: string | null;
  finishedAt: string | null;
  counts: BulkCampaignCounts;
  createdByName: string | null;
  sentByName: string | null;
};

/** A row of the campaign list. */
export type BulkCampaignListItem = Pick<
  BulkCampaignDto,
  | 'id'
  | 'name'
  | 'subject'
  | 'status'
  | 'recipientCount'
  | 'createdAt'
  | 'updatedAt'
  | 'sendStartedAt'
  | 'finishedAt'
  | 'counts'
  | 'createdByName'
  | 'sentByName'
>;

/** `POST /api/bulk-email/audience/count`. */
export type BulkAudienceCount = {
  count: number;
  /** Matched but left out, per reason. People who never signed in are included (P1). */
  leftOut: { unsubscribed: number; disabled: number };
};

/** A row of `GET /api/bulk-email/campaigns/:id/recipients`. */
export type BulkRecipientItem = {
  userId: string;
  name: string;
  email: string;
  status: BulkRecipientStatus;
  error: string | null;
  sentAt: string | null;
};

/** One reason of `400 not_ready`, shown next to the block when `blockId` is set. */
export type BulkNotReadyProblem = {
  blockId?: string;
  problem: 'subject_missing' | 'no_blocks' | 'image_missing' | 'invalid_url';
};

/** Socket events of bulk email, to the admins room only; payload `{ campaignId }`. */
export const BulkEvents = { updated: 'bulk:updated' } as const;
export type BulkEventPayload = { campaignId: string };

/** `POST /api/bulk-email/campaigns`: a new draft needs only its internal name. */
export const BulkCampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(BULK_LIMITS.name),
});
export type BulkCampaignCreate = z.infer<typeof BulkCampaignCreateSchema>;

/** `GET /api/bulk-email/campaigns?cursor=`: newest first, `BULK_LIMITS.pageSize` per page. */
export type BulkCampaignPage = { items: BulkCampaignListItem[]; nextCursor: string | null };

/**
 * A person in the audience pickers and the "Show recipients" list. `role`: `admin` for admins
 * and superadmins, `ziadatel` for a person whose only active memberships are ziadatel ones,
 * else `client`. `groups`: the names of their active memberships, by name.
 */
export type BulkPerson = {
  id: string;
  name: string;
  email: string;
  role: BulkAudienceRole;
  groups: string[];
};

/** `POST /api/bulk-email/audience/people?cursor=`: the people who would get it, by name. */
export type BulkAudiencePage = { items: BulkPerson[]; nextCursor: string | null };

/** People search of the pickers: `GET /api/bulk-email/people?q=` (2–200 characters). */
export const BULK_PEOPLE_SEARCH = { minQuery: 2, maxQuery: 200, limit: 20 } as const;

/**
 * `POST /api/bulk-email/people/lookup`: the people behind saved ids (the editor shows the
 * included and left-out people of a draft by name). Unknown ids are left out of the answer.
 */
export const BulkPeopleLookupSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).max(BULK_LIMITS.audienceIds * 2),
});

/** `GET /api/bulk-email/campaigns/:id/recipients?status=&cursor=`: by name, 50 per page. */
export const BulkRecipientsQuerySchema = z.object({
  status: BulkRecipientStatusSchema.optional(),
  cursor: z.string().min(1).max(500).optional(),
});
export type BulkRecipientsQuery = z.infer<typeof BulkRecipientsQuerySchema>;
export type BulkRecipientPage = { items: BulkRecipientItem[]; nextCursor: string | null };

/** `400 not_ready` of `POST …/send` and `POST …/test`: what is missing, by block. */
export type BulkNotReadyAnswer = { error: 'not_ready'; problems: BulkNotReadyProblem[] };

/** `202` of `POST …/test`: the test goes to the signed-in admin's own address only. */
export type BulkTestSendResult = { to: string };
