import { z } from 'zod';
import { isHttpUrl, MAX_URL_LENGTH } from './urls.js';
import { UserLanguages } from './notifications.js';
import { countBlocks, textOfNodes } from './bulk-email-content.js';

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
  /** Phase 31: nodes of one text block and runs of one node. */
  textNodes: 200,
  textRuns: 200,
  /** Phase 31: an image's chosen width; px at most the 520 px content column. */
  imagePercent: { min: 10, max: 100 },
  imagePx: { min: 40, max: 520 },
  /** Phase 31: the editor warns when the HTML gets close to Gmail's ~102 kB clipping. */
  htmlWarnBytes: 90_000,
  /** A container's corner radius in px (2026-10-21). */
  containerRadius: { min: 0, max: 32 },
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

export const BulkAlignSchema = z.enum(['left', 'center', 'right']);
export type BulkAlign = z.infer<typeof BulkAlignSchema>;

/**
 * Phase 31: the stored content version. 1 = Phase 23 (a text block is `{ text }` with
 * `**bold**`), 2 = builder v2 (a text block is a document tree). Reading upgrades 1 → 2
 * (`upgradeBlocks`); every save writes 2.
 */
export const BULK_CONTENT_VERSION = 2;

/**
 * The email palette (docs/design/tokens.md): the only colours an admin can pick, by key. The
 * renderer maps a key to its hex; a CSS value never reaches the email.
 */
export const BulkPalette = {
  ink: '#141414',
  muted: '#6B6B6B',
  green: '#007A37',
  red: '#D60004',
  purple: '#7654FF',
  blue: '#3242DC',
  line: '#E3DEDA',
} as const;
export type BulkColor = keyof typeof BulkPalette;
/** Text colours: every palette key but `line` (too light on white). */
export const BulkTextColors = ['ink', 'muted', 'green', 'red', 'purple', 'blue'] as const;
export type BulkTextColor = (typeof BulkTextColors)[number];
/** Divider colours of a split container; `line` is the default. */
export const BulkLineColors = ['line', 'ink', 'muted', 'green', 'purple', 'blue'] as const;
export type BulkLineColor = (typeof BulkLineColors)[number];

/**
 * Background colours of a container (2026-10-21): the light egrant surfaces and 10 % tints of the
 * brand colours, so the default black text stays readable. A custom `#RRGGBB` is allowed too
 * (`BulkBackgroundSchema`).
 */
export const BulkBackgroundPalette = {
  base: '#F5F3F1',
  tile: '#F0EDEA',
  sand: '#E4E2DD',
  greenTint: '#E6F2EB',
  purpleTint: '#F1EEFF',
  blueTint: '#EBECFC',
} as const;
export type BulkBackgroundColor = keyof typeof BulkBackgroundPalette;
export const BulkBackgroundColors = Object.keys(BulkBackgroundPalette) as BulkBackgroundColor[];
/** A custom colour: exactly `#RRGGBB` (no names, no `rgb()`, nothing else reaches the email). */
export const BULK_HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const BulkBackgroundSchema = z.union([
  z.enum(Object.keys(BulkBackgroundPalette) as [BulkBackgroundColor, ...BulkBackgroundColor[]]),
  z.string().regex(BULK_HEX_COLOR),
]);
export type BulkBackground = z.infer<typeof BulkBackgroundSchema>;

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

/** `http(s)://` or `mailto:<address>` (buttons and links in a text). */
export const isBulkLinkUrl = (v: string): boolean => isHttpUrl(v) || isMailto(v);

const blockId = z.string().min(1).max(BULK_LIMITS.blockId);

export const BulkMarks = ['bold', 'italic', 'underline', 'strike'] as const;
export type BulkMark = (typeof BulkMarks)[number];

/**
 * A run of text with one formatting. `text` may hold `\n` (a line break) and `{{name}}`.
 * Unknown keys are dropped: the browser never sends HTML or styles, only this tree, and this
 * schema is the allowlist of what a text may hold (spec §2).
 */
export const BulkInlineSchema = z.object({
  text: z.string().max(BULK_LIMITS.text),
  marks: z
    .array(z.enum(BulkMarks))
    .max(BulkMarks.length)
    .refine((m) => new Set(m).size === m.length, { message: 'repeated mark' })
    .optional(),
  href: buttonUrl.optional(),
  color: z.enum(BulkTextColors).optional(),
});
export type BulkInline = z.infer<typeof BulkInlineSchema>;

/** A paragraph, a heading level 2 or 3, or one item of a bulleted or numbered list. */
export const BulkTextNodeTypes = ['paragraph', 'h2', 'h3', 'bullet', 'ordered'] as const;
export type BulkTextNodeType = (typeof BulkTextNodeTypes)[number];
export const BulkTextNodeSchema = z.object({
  type: z.enum(BulkTextNodeTypes),
  /** Left out: the block's `align`. */
  align: BulkAlignSchema.optional(),
  content: z.array(BulkInlineSchema).max(BULK_LIMITS.textRuns),
});
export type BulkTextNode = z.infer<typeof BulkTextNodeSchema>;

export const BulkImageShapes = ['square', 'rounded', 'roundedLarge', 'circle'] as const;
export type BulkImageShape = (typeof BulkImageShapes)[number];
export const BulkImageWidthSchema = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('percent'),
    value: z.number().int().min(BULK_LIMITS.imagePercent.min).max(BULK_LIMITS.imagePercent.max),
  }),
  z.object({
    unit: z.literal('px'),
    value: z.number().int().min(BULK_LIMITS.imagePx.min).max(BULK_LIMITS.imagePx.max),
  }),
]);
export type BulkImageWidth = z.infer<typeof BulkImageWidthSchema>;

export const BulkSpacerSizes = ['small', 'medium', 'large'] as const;
export type BulkSpacerSize = (typeof BulkSpacerSizes)[number];
export const BulkColumnRatios = ['50-50', '33-67', '67-33'] as const;
export type BulkColumnRatio = (typeof BulkColumnRatios)[number];
export const BulkVAligns = ['top', 'middle', 'bottom'] as const;
export type BulkVAlign = (typeof BulkVAligns)[number];
/**
 * A container's mode (2026-10-21): `plain` is one area of blocks (stored in `left`), `split` the
 * two columns of Phase 31. Left out: `split`, so containers saved before it render unchanged.
 */
export const BulkContainerModes = ['plain', 'split'] as const;
export type BulkContainerMode = (typeof BulkContainerModes)[number];
/** Inner space of a container: 0, 12, 24 or 32 px. Left out: none. */
export const BulkContainerPaddings = ['none', 'small', 'medium', 'large'] as const;
export type BulkContainerPadding = (typeof BulkContainerPaddings)[number];

const headingBlock = z.object({
  id: blockId,
  type: z.literal('heading'),
  text: z.string().max(BULK_LIMITS.heading),
  align: BulkAlignSchema,
});
const textBlock = z.object({
  id: blockId,
  type: z.literal('text'),
  /** The nodes' default alignment and the cell's `align` (Outlook reads the attribute). */
  align: BulkAlignSchema,
  content: z
    .array(BulkTextNodeSchema)
    .max(BULK_LIMITS.textNodes)
    .refine((nodes) => textOfNodes(nodes).length <= BULK_LIMITS.text, {
      message: 'text too long',
    }),
});
const imageBlock = z.object({
  id: blockId,
  type: z.literal('image'),
  imageId: z.string().min(1).max(100),
  alt: z.string().trim().min(1).max(BULK_LIMITS.alt),
  href: httpUrl.optional(),
  /** Left out: centred (Phase 23). */
  align: BulkAlignSchema.optional(),
  /** Left out: the image's own width, at most the column (Phase 23). */
  width: BulkImageWidthSchema.optional(),
  /** Left out: square corners. */
  shape: z.enum(BulkImageShapes).optional(),
});
const buttonBlock = z.object({
  id: blockId,
  type: z.literal('button'),
  label: z.string().max(BULK_LIMITS.buttonLabel),
  url: buttonUrl,
  align: BulkAlignSchema,
});
const dividerBlock = z.object({ id: blockId, type: z.literal('divider') });
const logoBlock = z.object({ id: blockId, type: z.literal('logo'), align: BulkAlignSchema });
const spacerBlock = z.object({
  id: blockId,
  type: z.literal('spacer'),
  size: z.enum(BulkSpacerSizes),
});

/** Any block that may stand inside a split container: every type but `columns`. */
export const BulkLeafBlockSchema = z.discriminatedUnion('type', [
  headingBlock,
  textBlock,
  imageBlock,
  buttonBlock,
  dividerBlock,
  logoBlock,
  spacerBlock,
]);
export type BulkLeafBlock = z.infer<typeof BulkLeafBlockSchema>;

const columnSide = z.array(BulkLeafBlockSchema).max(BULK_LIMITS.blocks);

/**
 * The container ("Kontajner", type `columns` for the stored data): one area (`mode: 'plain'`,
 * the blocks in `left`) or two columns of leaf blocks (`split`, the Phase 31 split container);
 * no container in a container. The look (`radius`, `background`, `padding`) is optional, and a
 * container without it renders byte for byte as before. `ratio`, `valign` and the divider are
 * kept in plain mode too, so switching back to split restores them.
 */
export const BulkColumnsBlockSchema = z
  .object({
    id: blockId,
    type: z.literal('columns'),
    mode: z.enum(BulkContainerModes).optional(),
    ratio: z.enum(BulkColumnRatios),
    valign: z.enum(BulkVAligns),
    divider: z.boolean(),
    dividerColor: z.enum(BulkLineColors),
    radius: z
      .number()
      .int()
      .min(BULK_LIMITS.containerRadius.min)
      .max(BULK_LIMITS.containerRadius.max)
      .optional(),
    background: BulkBackgroundSchema.optional(),
    padding: z.enum(BulkContainerPaddings).optional(),
    left: columnSide,
    right: columnSide,
  })
  // A plain container has one area, `left`; nothing may hide in `right`.
  .refine((b) => b.mode !== 'plain' || b.right.length === 0, {
    message: 'a plain container holds its blocks in left',
    path: ['right'],
  });
export type BulkColumnsBlock = z.infer<typeof BulkColumnsBlockSchema>;

export const BulkBlockSchema = z.discriminatedUnion('type', [
  headingBlock,
  textBlock,
  imageBlock,
  buttonBlock,
  dividerBlock,
  logoBlock,
  spacerBlock,
  BulkColumnsBlockSchema,
]);
export type BulkBlock = z.infer<typeof BulkBlockSchema>;
export type BulkBlockType = BulkBlock['type'];

/** One version of the email: at most `BULK_LIMITS.blocks`, counting blocks inside containers. */
export const BulkBlocksSchema = z
  .array(BulkBlockSchema)
  .max(BULK_LIMITS.blocks)
  .refine((blocks) => countBlocks(blocks) <= BULK_LIMITS.blocks, { message: 'too many blocks' });

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
  /** The desktop version. */
  blocks: BulkBlocksSchema,
  /**
   * The phone version (Phase 31): `null` = it follows the desktop version; left out = keep the
   * stored one (an editor that does not know it never drops it).
   */
  phoneBlocks: BulkBlocksSchema.nullable().optional(),
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
  /** The desktop version, always content version 2 (older rows are upgraded on read). */
  blocks: BulkBlock[];
  /** The phone version; `null` while it follows the desktop version. */
  phoneBlocks: BulkBlock[] | null;
  /** The one-time "check the phone version" warning was shown before a send (spec §5). */
  phoneCheckShown: boolean;
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
  /** The problem is in the phone version (Phase 31). */
  phone?: true;
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

/**
 * `GET /api/bulk-email/unsubscribe/:token` (public): what the unsubscribe page needs and nothing
 * more (no name, no address). `test`: the link of a test email, which changes nothing.
 */
export const BulkUnsubscribeInfoSchema = z.object({
  language: z.enum(UserLanguages),
  subscribed: z.boolean(),
  test: z.boolean(),
});
export type BulkUnsubscribeInfo = z.infer<typeof BulkUnsubscribeInfoSchema>;

/** `GET`/`PUT /api/me/bulk-email`: the signed-in person's "Receive mailings" setting. */
export const BulkSubscriptionSchema = z.object({ subscribed: z.boolean() });
export type BulkSubscription = z.infer<typeof BulkSubscriptionSchema>;

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
/** `GET /api/bulk-email/sender`: the From address bulk email goes out with (`MAIL_FROM_BULK`). */
export type BulkSenderDto = { sender: string };
