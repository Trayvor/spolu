import { z } from 'zod';
import { isStrictBase64 } from './files.js';
import { GroupModeSchema } from './notifications.js';

const groupName = z.string().trim().min(1).max(100);

/**
 * `client`: a client's group (an eGrant instance). `admin`: the one internal group "eGrant tím"
 * (Phase 34), read by every admin, never by a client; it has no eGrant URL, members or tickets.
 */
export const GroupKindSchema = z.enum(['client', 'admin']);
export type GroupKind = z.infer<typeof GroupKindSchema>;
/** A client's group, not the admin group: what client lists, counts and pickers show. */
export const isClientGroup = (group: { kind: GroupKind }): boolean => group.kind === 'client';

/** An active admin who manages a group. */
export const GroupManagerSchema = z.object({ id: z.string(), name: z.string() });
export type GroupManager = z.infer<typeof GroupManagerSchema>;

export const GroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The server always sends it; the default keeps older payloads (and fixtures) valid. */
  kind: GroupKindSchema.default('client'),
  hasLogo: z.boolean(),
  memberCount: z.number().int(),
  /** Cache-buster for the logo URL (`?v=`). */
  updatedAt: z.string(),
  /** Active admins who manage the group, by name. */
  managers: z.array(GroupManagerSchema),
  /** Whether the viewer is one of the managers. */
  managedByMe: z.boolean(),
  /** When the group was deactivated (admins only see such a group); null while active. */
  deactivatedAt: z.string().nullish(),
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export const GroupSummaryListSchema = z.array(GroupSummarySchema);

/** The largest page of `GET /groups?limit=` (2026-10-18). */
export const GROUP_PAGE_MAX = 200;

/**
 * `GET /groups` query (2026-10-18). Without `limit` the answer is every group as before
 * (`GroupSummaryListSchema`); with `limit` it is one page (`GroupPageSchema`), by name and id,
 * continued with the page's `nextCursor`. `q` keeps the groups whose name contains it (either way).
 */
export const GroupListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(GROUP_PAGE_MAX).optional(),
    cursor: z.string().min(1).max(1000).optional(),
    q: z.string().trim().max(100).optional(),
    /** `true`: the deactivated client groups instead of the active ones. */
    deactivated: z.enum(['true', 'false']).optional(),
  })
  .refine((v) => v.cursor === undefined || v.limit !== undefined, {
    message: 'cursor needs limit',
  });
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>;

/** One page of `GET /groups?limit=`: `nextCursor` is null on the last page. */
export const GroupPageSchema = z.object({
  items: z.array(GroupSummarySchema),
  nextCursor: z.string().nullable(),
});
export type GroupPage = z.infer<typeof GroupPageSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The server always sends it; the default keeps older payloads (and fixtures) valid. */
  kind: GroupKindSchema.default('client'),
  /** Null only for the admin group. */
  egrantUrl: z.string().nullable(),
  hasLogo: z.boolean(),
  updatedAt: z.string(),
  /** When the group was deactivated: read-only, only admins open it; null while active. */
  deactivatedAt: z.string().nullish(),
  /** Admins only. */
  inviteUrl: z.string().optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupInputSchema = z.object({ name: groupName, egrantUrl: z.string().max(2048) });
export type GroupInput = z.infer<typeof GroupInputSchema>;
/** Editing the admin group: its name only (the logo has its own route). */
export const AdminGroupInputSchema = z.object({ name: groupName });
export type AdminGroupInput = z.infer<typeof AdminGroupInputSchema>;

export const MemberSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type Member = z.infer<typeof MemberSchema>;
export const MemberListSchema = z.array(MemberSchema);

export const GroupPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
  /** An admin who manages this group. Always false for clients. */
  isManager: z.boolean(),
  /**
   * A manager only because they substitute this admin (2026-10-19): the substituted admin's
   * name, shown as "zastupuje <name>". Absent otherwise.
   */
  substitutesFor: z.string().nullish(),
});
export type GroupPerson = z.infer<typeof GroupPersonSchema>;
/** Who can be assigned or picked: the group's clients and its managers, not every admin. */
export const isPickable = (person: GroupPerson): boolean => !person.isAdmin || person.isManager;
export const GroupPersonListSchema = z.array(GroupPersonSchema);

export const JoinInfoSchema = z.object({
  name: z.string(),
  hasLogo: z.boolean(),
  /** ISO time of the last group change; the join page appends it to the logo URL as a cache key. */
  updatedAt: z.string(),
});
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const JoinBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type JoinBody = z.infer<typeof JoinBodySchema>;

/** Body of `POST /api/groups/:id/members`: an admin adds a person by email (name optional). */
export const InviteMemberBodySchema = z.object({
  email: JoinBodySchema.shape.email,
  name: z.string().trim().max(100).optional(),
});
export type InviteMemberBody = z.infer<typeof InviteMemberBodySchema>;

/**
 * `invited`: the person has not signed in yet and got an invitation ("Pozvaný"); `resent`: they
 * were invited already and got it again; `added`: a signed-in client, a member at once.
 */
export const InviteOutcomeSchema = z.enum(['invited', 'resent', 'added']);
export type InviteOutcome = z.infer<typeof InviteOutcomeSchema>;

export const InviteMemberResponseSchema = z.object({
  member: MemberSchema,
  outcome: InviteOutcomeSchema,
});
export type InviteMemberResponse = z.infer<typeof InviteMemberResponseSchema>;

export const NameBodySchema = z.object({ name: groupName });
export type NameBody = z.infer<typeof NameBodySchema>;

/** Answer of `PUT` and `DELETE /api/groups/:id/managers/me`: `mode` is the caller's effective mode for the group. */
export const ManagersResponseSchema = z.object({
  managers: z.array(GroupManagerSchema),
  managedByMe: z.boolean(),
  mode: GroupModeSchema,
});
export type ManagersResponse = z.infer<typeof ManagersResponseSchema>;

/** Answer of `PUT` and `DELETE /api/groups/:id/managers/:userId`: the group's managers after the change. */
export const GroupManagersResponseSchema = z.object({ managers: z.array(GroupManagerSchema) });
export type GroupManagersResponse = z.infer<typeof GroupManagersResponseSchema>;

export const GroupEvents = { managers: 'group:managers', status: 'group:status' } as const;

/**
 * Pushed to the admins room when a client group is deactivated or reactivated (and to the group
 * room on reactivation): lists and the group page refetch.
 */
export type GroupStatusEvent = { groupId: string; deactivatedAt: string | null };

/** Pushed to the group room and the admins room when a group's managers change. */
export type GroupManagersEvent = { groupId: string; managers: GroupManager[] };

/**
 * `PUT /api/egrant/managers` (the eGrant managers webhook). In eGrant a manager of an
 * organisation is the client's own person: `active: true` makes `email` a client member of the
 * client group of `instance_url` (creating a client account named `name` when none exists),
 * `false` removes that membership. `instance_url` is a URL or a bare host of the eGrant
 * instance, matched by host like the ticket intake.
 */
export const EgrantManagerBodySchema = z.object({
  instance_url: z.string().trim().min(1).max(2048),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  active: z.boolean(),
  name: z.string().trim().max(100).nullish(),
});
export type EgrantManagerBody = z.infer<typeof EgrantManagerBodySchema>;

/**
 * `created`: a new client account was made and added; `added`: an existing account became a
 * client member; `removed`: the client membership was removed; `unchanged`: it was so already.
 * `user_id` is null only for `active: false` with an email Help does not know.
 */
export const EgrantManagerResponseSchema = z.object({
  state: z.enum(['created', 'added', 'removed', 'unchanged']),
  group_id: z.string(),
  user_id: z.string().nullable(),
});
export type EgrantManagerResponse = z.infer<typeof EgrantManagerResponseSchema>;

/** Limits of the eGrant groups webhook (`PUT /api/egrant/groups`). */
export const EGRANT_GROUP_LIMITS = {
  /** The decoded logo. */
  logoBytes: 2 * 1024 * 1024,
  /** A decoded SVG logo (ADR 0039: rendered on the server, so kept small). */
  svgLogoBytes: 512 * 1024,
  /** The longest side of a PNG, JPEG or WebP logo, read from its header. */
  logoPixels: 4096,
  /** The longest side an SVG logo may declare (width, height or viewBox), in user units. */
  svgLogoUnits: 16384,
  /** The JSON body: the logo as base64 (a third more) plus the other fields. */
  bodyBytes: 3 * 1024 * 1024,
} as const;

/**
 * `PUT /api/egrant/groups` (the eGrant groups webhook): creates the client group of
 * `instance_url` or updates its name and logo. `instance_url` is a URL or a bare host, matched by
 * host like the other webhooks. `logo` omitted keeps the current logo, `null` removes it. The
 * route checks `content_type` against PNG, JPEG, WebP and SVG (415) and the bytes (422), not here.
 */
export const EgrantGroupBodySchema = z.object({
  instance_url: z.string().trim().min(1).max(2048),
  name: groupName,
  logo: z
    .object({
      content_type: z.string().trim().toLowerCase().min(1).max(100),
      data_base64: z.string().min(1).refine(isStrictBase64, { message: 'not strict base64' }),
    })
    .nullish(),
  /**
   * `false` deactivates the group, `true` reactivates it. Omitted keeps its current state, so a
   * name sync never undoes an admin's deactivation; a new group is always active.
   */
  active: z.boolean().optional(),
});
export type EgrantGroupBody = z.infer<typeof EgrantGroupBodySchema>;

/**
 * `created` (201): a new client group; `updated` (200): its name or logo changed; `unchanged`
 * (200): nothing to change; `deactivated` / `reactivated` (200): its state changed (a name or
 * logo sent with it is applied too).
 */
export const EgrantGroupResponseSchema = z.object({
  state: z.enum(['created', 'updated', 'unchanged', 'deactivated', 'reactivated']),
  group_id: z.string(),
});
export type EgrantGroupResponse = z.infer<typeof EgrantGroupResponseSchema>;

/**
 * `GET /api/invitations/context?token=&email=` (X19): what an invitation link's signed context
 * says, for `/login` and `/welcome`. `invitedBy` is the inviting admin's name, or "eGrant" for an
 * account eGrant added.
 */
export const InviteContextSchema = z.object({
  groupName: z.string(),
  invitedBy: z.string(),
});
export type InviteContext = z.infer<typeof InviteContextSchema>;
