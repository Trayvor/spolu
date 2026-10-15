import { z } from 'zod';
import type { Role } from './users.js';

/** Every kind of notification event; declared up front so chat and tasks add no edits here. */
export const NotificationKinds = [
  'chat.message',
  'chat.mention',
  'chat.thread_reply',
  'task.moved',
  'task.assigned',
  'task.deadline',
  'task.urgent',
] as const;
export type NotificationKind = (typeof NotificationKinds)[number];

/** How much of a group's chat notifies the user: everything, only mentions, or nothing. */
export const GroupModes = ['all', 'mentions', 'off'] as const;
export const GroupModeSchema = z.enum(GroupModes);
export type GroupMode = z.infer<typeof GroupModeSchema>;

/** Clients hear everything in their group; admins only mentions. */
export function roleDefaultMode(role: Role): GroupMode {
  return role === 'client' ? 'all' : 'mentions';
}

/** The per-group override wins, then the user's own default, then the role default. */
export function effectiveGroupMode(input: {
  override: GroupMode | null;
  defaultMode: GroupMode | null;
  role: Role;
}): GroupMode {
  return input.override ?? input.defaultMode ?? roleDefaultMode(input.role);
}

/** The user's default mode, the role default and the per-group overrides keyed by group id. */
export const NotificationModesSchema = z.object({
  defaultMode: GroupModeSchema.nullable(),
  roleDefault: GroupModeSchema,
  overrides: z.record(z.string(), GroupModeSchema),
});
export type NotificationModes = z.infer<typeof NotificationModesSchema>;

export const ModeBodySchema = z.object({ mode: GroupModeSchema });
export type ModeBody = z.infer<typeof ModeBodySchema>;

/** The user's two delivery switches, plus the VAPID key (null when push is not configured). */
export const NotificationPrefsSchema = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  vapidPublicKey: z.string().nullable(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const NotificationPrefsPatchSchema = z
  .object({ pushEnabled: z.boolean().optional(), emailEnabled: z.boolean().optional() })
  .strict()
  .refine((p) => p.pushEnabled !== undefined || p.emailEnabled !== undefined, {
    message: 'At least one switch is required',
  });
export type NotificationPrefsPatch = z.infer<typeof NotificationPrefsPatchSchema>;

/** A browser `PushSubscription.toJSON()`; unknown fields such as `expirationTime` are stripped. */
export const PushSubscriptionBodySchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBodySchema>;

export const EndpointBodySchema = z.object({ endpoint: z.string().min(1).max(2048) });
export type EndpointBody = z.infer<typeof EndpointBodySchema>;

/** What the service worker shows. */
export type PushPayload = { title: string; body: string; url: string; tag: string };

export type TaskDeadlinePayload = {
  taskId: string;
  groupId: string;
  title: string;
  daysLeft: 1 | 2 | 3;
};
export type TaskUrgentPayload = { taskId: string; groupId: string; title: string };

export const UserLanguages = ['sk', 'en'] as const;
export type UserLanguage = (typeof UserLanguages)[number];
export const LanguageBodySchema = z.object({ language: z.enum(UserLanguages) });
export type LanguageBody = z.infer<typeof LanguageBodySchema>;

const NewEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const EmailChangeRequestSchema = z.object({ newEmail: NewEmailSchema });
export type EmailChangeRequest = z.infer<typeof EmailChangeRequestSchema>;

export const EmailChangeConfirmSchema = z.object({
  newEmail: NewEmailSchema,
  code: z.string().regex(/^\d{6}$/),
});
export type EmailChangeConfirm = z.infer<typeof EmailChangeConfirmSchema>;
