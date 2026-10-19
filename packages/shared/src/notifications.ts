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
  // 2026-10-18: a task's due date changed or was removed (to its assignees); an open task is past
  // its due date (once per due date, to its assignees).
  'task.due_changed',
  'task.overdue',
  'reminder.due',
  // Phase 32: a completed task asks its other admin assignees for their time (Task board group).
  'task.time_missing',
  // Phase 21: support tickets (the `tickets` notification group).
  'ticket.created',
  'ticket.unassigned',
  'ticket.message',
  'ticket.status',
  'ticket.updated',
  'ticket.tasks',
  // A person became a riešiteľ (assignee) of a ticket.
  'ticket.assigned',
  // 2026-10-18: the ticket was resolved (to its riešitelia, its watchers and its initiator).
  'ticket.resolved',
  // 2026-10-19: a 👎 rating (once per rating) to the ticket's admin owners.
  'ticket.rated',
  // Phase 32: a resolved ticket asks its other admin riešitelia for their time.
  'ticket.time_missing',
  // 2026-10-17: meetings (the `meetings` notification group). A meeting was created with a start
  // in the future, or its start moved (to the future); an AI run ended with a summary or failed.
  'meeting.scheduled',
  'meeting.rescheduled',
  'meeting.summary_ready',
  'meeting.summary_failed',
  // F16 (2026-10-18): someone was named with `@` in a task, ticket, project or knowledge
  // description. Its group follows the subject (`notificationGroupOf`).
  'description.mention',
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

/**
 * The per-group override wins, then the user's own default, then the role default. In the admin
 * group (Phase 34) `all` comes before the user's default: a team chat nobody hears is not a chat.
 */
export function effectiveGroupMode(input: {
  override: GroupMode | null;
  defaultMode: GroupMode | null;
  role: Role;
  adminGroup?: boolean;
}): GroupMode {
  if (input.override) return input.override;
  if (input.adminGroup) return 'all';
  return input.defaultMode ?? roleDefaultMode(input.role);
}

/**
 * The user's default mode, the role default and the per-group overrides keyed by group id.
 * `managerSet` lists the groups whose override was set by becoming their manager (origin
 * `manager`); it goes away when the user stops managing the group.
 */
export const NotificationModesSchema = z.object({
  defaultMode: GroupModeSchema.nullable(),
  roleDefault: GroupModeSchema,
  overrides: z.record(z.string(), GroupModeSchema),
  managerSet: z.array(z.string()),
  /** The admin group's id (admins only; its default mode is `all`), else null. */
  adminGroupId: z.string().nullable().optional(),
});
export type NotificationModes = z.infer<typeof NotificationModesSchema>;

export const ModeBodySchema = z.object({ mode: GroupModeSchema });
export type ModeBody = z.infer<typeof ModeBodySchema>;

/**
 * Notification groups: each event belongs to one, and the user picks a channel per group. The
 * order is the profile's order. Item B (tickets) uses `tickets`; `meetings` (2026-10-17) holds the
 * meeting events and a meeting's reminders; `finance` (Phase 32) the finance reminders, shown
 * and delivered only to finance admins.
 */
export const NotificationCategories = [
  'chat',
  'tasks',
  'tickets',
  'knowledge',
  'meetings',
  'finance',
] as const;
export const NotificationCategorySchema = z.enum(NotificationCategories);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationChannels = ['email', 'push', 'both', 'none'] as const;
export const NotificationChannelSchema = z.enum(NotificationChannels);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export type ChannelMap = Record<NotificationCategory, NotificationChannel>;

/** Tickets arrive by email and push; everything else by push only. */
export const DEFAULT_CHANNELS: Readonly<ChannelMap> = Object.freeze({
  chat: 'push',
  tasks: 'push',
  tickets: 'both',
  knowledge: 'push',
  meetings: 'push',
  finance: 'push',
});

export const wantsPush = (channel: NotificationChannel): boolean =>
  channel === 'push' || channel === 'both';
export const wantsEmail = (channel: NotificationChannel): boolean =>
  channel === 'email' || channel === 'both';

/** The stored choices over the defaults; anything that is not a known channel is ignored. */
export function resolveChannels(stored: unknown): ChannelMap {
  const result: ChannelMap = { ...DEFAULT_CHANNELS };
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return result;
  for (const category of NotificationCategories) {
    const value = NotificationChannelSchema.safeParse(
      (stored as Record<string, unknown>)[category],
    );
    if (value.success) result[category] = value.data;
  }
  return result;
}

/**
 * The user's channel per group, the groups the profile shows (the server decides), and the VAPID
 * key (null when push is not configured).
 */
export const NotificationPrefsSchema = z.object({
  channels: z.object({
    chat: NotificationChannelSchema,
    tasks: NotificationChannelSchema,
    tickets: NotificationChannelSchema,
    knowledge: NotificationChannelSchema,
    meetings: NotificationChannelSchema,
    finance: NotificationChannelSchema,
  }),
  visibleCategories: z.array(NotificationCategorySchema),
  vapidPublicKey: z.string().nullable(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

/** `POST /api/me/notification-fallback`: the preferences, and whether this call added email. */
export const NotificationFallbackSchema = NotificationPrefsSchema.extend({ turnedOn: z.boolean() });
export type NotificationFallback = z.infer<typeof NotificationFallbackSchema>;

/** One group's channel. */
export const NotificationPrefsPatchSchema = z
  .object({ category: NotificationCategorySchema, channel: NotificationChannelSchema })
  .strict();
export type NotificationPrefsPatch = z.infer<typeof NotificationPrefsPatchSchema>;

/**
 * Hosts a push endpoint may point to: the browser vendors' push services. The server POSTs to the
 * endpoint a client sends, so anything else (internal hosts, IP addresses) would be SSRF.
 * An entry matches the host itself and its subdomains.
 */
export const PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
] as const;

function isPushEndpoint(value: string): boolean {
  // zod runs this refine even when `z.url` already failed: a malformed value must not throw.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.port) return false;
  return PUSH_ENDPOINT_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

/** A browser `PushSubscription.toJSON()`; unknown fields such as `expirationTime` are stripped. */
export const PushSubscriptionBodySchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .refine(isPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBodySchema>;

export const EndpointBodySchema = z.object({ endpoint: z.string().min(1).max(2048) });
export type EndpointBody = z.infer<typeof EndpointBodySchema>;

/** What the service worker shows. */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  /**
   * Alert again when it replaces a shown notification of the same tag (2026-10-18): set for what is
   * addressed to the person or due now; left out, a replacement is silent (a stream of messages).
   */
  renotify?: true;
  /**
   * N6a (ADR 0047): at most one contextual button, in the recipient's language. Ids only, the
   * same ones the URL already carries; the service worker acts through the HTTP API with the
   * session cookie, so every check stays on the server. Left out where no action fits (and on
   * finance and meeting pushes).
   */
  actions?: PushAction[];
};

/**
 * A push notification button. `done` posts `/api/tasks/:taskId/done`; `time` opens `url` (the
 * time dialog); `reply` sends the platform's inline reply to the channel (in the thread
 * `parentId`), or opens `url`, the chat with its composer focused, where there is none.
 */
export type PushAction =
  | { action: 'done'; title: string; taskId: string }
  | { action: 'time'; title: string; url: string }
  | {
      action: 'reply';
      title: string;
      placeholder: string;
      channelId: string;
      parentId: string | null;
      url: string;
    };

export type TaskDeadlinePayload = {
  taskId: string;
  groupId: string;
  title: string;
  daysLeft: 1 | 2 | 3;
};
export type TaskUrgentPayload = { taskId: string; groupId: string; title: string };
/** `task.due_changed` (2026-10-18): the new due date (null: removed) and the one before. */
export type TaskDueChangedPayload = {
  taskId: string;
  groupId: string;
  title: string;
  dueDate: string | null;
  previousDueDate: string | null;
  actorName: string;
};
/** `task.overdue` (2026-10-18): the due date that passed. */
export type TaskOverduePayload = {
  taskId: string;
  groupId: string;
  title: string;
  dueDate: string;
};

/** Payload of a `meeting.*` event: the knowledge item, its title and its start (ISO). */
export type MeetingEventPayload = {
  itemId: string;
  groupId: string;
  title: string;
  startsAt: string;
};

/**
 * Every UI and email language. `sk` is the default of a new account and the email fallback; the
 * web lists them in `apps/web/src/i18n/languages.ts`. Adding one needs a migration of the
 * `language` checks (`user`, `bulk_recipients`) and its texts on the server and the web.
 */
export const UserLanguages = ['sk', 'en', 'cs', 'sl', 'bg', 'et', 'it', 'hr', 'uk'] as const;
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

/**
 * Sent to the user's own room after they opened a task or a ticket (`POST /tasks/:id/seen`,
 * `POST /tickets/:id/seen`, 2026-10-17): their other devices refetch the unseen marks and counts.
 * `groupId` (2026-10-18; null for a ticket without a client) lets the admin sidebar patch one row.
 */
export const SeenEvents = { changed: 'seen:changed' } as const;
export type SeenChangedEvent = { kind: 'task' | 'ticket'; id: string; groupId?: string | null };
