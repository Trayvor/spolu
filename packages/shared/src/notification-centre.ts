import { z } from 'zod';
import { GroupKindSchema } from './groups.js';

/**
 * The notification centre (UX review F2, 2026-10-18): the bell in the header lists what the
 * person was notified about, newest first, with the texts of the push and its link.
 */

/** The largest page of `GET /api/me/notifications`. */
export const NOTIFICATION_PAGE_MAX = 50;
/** The bell counts unread items up to this many; more shows as "99+". */
export const NOTIFICATION_UNREAD_CAP = 100;

export const NotificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_MAX).optional(),
  cursor: z.string().min(1).max(500).optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  /** The push's title and text, in the person's language. */
  title: z.string(),
  body: z.string(),
  /** Where it opens: an app path (`/groups/…`, `/tickets/…`). */
  url: z.string(),
  createdAt: z.string(),
  /** Newer than the person's last "Mark all as read". */
  unread: z.boolean(),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationPageSchema = z.object({
  items: z.array(NotificationItemSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/** The bell: how many unread (at most `NOTIFICATION_UNREAD_CAP`) and until when pushes are snoozed. */
export const NotificationCentreStateSchema = z.object({
  unread: z.number().int().min(0),
  snoozedUntil: z.string().nullable(),
});
export type NotificationCentreState = z.infer<typeof NotificationCentreStateSchema>;

/** "Stíšiť na 1 h / do zajtra / na týždeň"; null ends the snooze. */
export const SnoozeLengths = ['hour', 'tomorrow', 'week'] as const;
export const SnoozeBodySchema = z.object({ for: z.enum(SnoozeLengths).nullable() });
export type SnoozeBody = z.infer<typeof SnoozeBodySchema>;
export type SnoozeLength = (typeof SnoozeLengths)[number];

/** One row of the client table on `/settings/notifications` (UX review X7). */
export const NotificationGroupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: GroupKindSchema,
  /** The viewer manages this client. */
  managed: z.boolean(),
  /** "New tickets of this client" for the viewer; null where tickets do not apply (the admin group). */
  watching: z.boolean().nullable(),
});
export type NotificationGroupRow = z.infer<typeof NotificationGroupRowSchema>;

export const NotificationGroupsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(1000).optional(),
});

/**
 * A page of the client table: `managed` (the first page only) holds the clients the viewer
 * manages, `items` the others by name; `nextCursor` continues `items`.
 */
export const NotificationGroupsPageSchema = z.object({
  managed: z.array(NotificationGroupRowSchema),
  items: z.array(NotificationGroupRowSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationGroupsPage = z.infer<typeof NotificationGroupsPageSchema>;
