import { z } from 'zod';
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
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export const GroupSummaryListSchema = z.array(GroupSummarySchema);

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The server always sends it; the default keeps older payloads (and fixtures) valid. */
  kind: GroupKindSchema.default('client'),
  /** Null only for the admin group. */
  egrantUrl: z.string().nullable(),
  hasLogo: z.boolean(),
  updatedAt: z.string(),
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

export const GroupEvents = { managers: 'group:managers' } as const;

/** Pushed to the group room and the admins room when a group's managers change. */
export type GroupManagersEvent = { groupId: string; managers: GroupManager[] };

/**
 * `PUT /api/egrant/managers` (the eGrant managers webhook): make `email` a manager of the client
 * of `instance_url` (`active: true`) or stop it being one (`false`). `instance_url` is a URL or a
 * bare host of the eGrant instance, matched by host like the ticket intake.
 */
export const EgrantManagerBodySchema = z.object({
  instance_url: z.string().trim().min(1).max(2048),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  active: z.boolean(),
});
export type EgrantManagerBody = z.infer<typeof EgrantManagerBodySchema>;

/** `added` / `removed`: the webhook changed the managers; `unchanged`: it was so already. */
export const EgrantManagerResponseSchema = z.object({
  state: z.enum(['added', 'removed', 'unchanged']),
  group_id: z.string(),
  user_id: z.string(),
});
export type EgrantManagerResponse = z.infer<typeof EgrantManagerResponseSchema>;
