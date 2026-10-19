import { z } from 'zod';

/**
 * The personal calendar feed (ICS subscription, ADR 0051): what the person's calendar shows.
 * The same three switches for admins and clients (owner decision 2026-10-19).
 */
export const CalendarFeedIncludeSchema = z
  .object({ events: z.boolean(), tasks: z.boolean(), calls: z.boolean() })
  .strict();
export type CalendarFeedInclude = z.infer<typeof CalendarFeedIncludeSchema>;

/** `PUT /api/me/calendar-feed`: creates the feed or changes its switches. */
export const CalendarFeedPutBodySchema = z.object({ include: CalendarFeedIncludeSchema }).strict();
export type CalendarFeedPutBody = z.infer<typeof CalendarFeedPutBodySchema>;

/** The person's feed: its subscription URL (derived, shown again any time) and switches. */
export const CalendarFeedSchema = z.object({
  /** `https://<host>/api/public/calendar/<token>/help.ics` */
  url: z.string(),
  /** The same URL with `webcal://`: the system's calendar app subscribes to it. */
  webcalUrl: z.string(),
  /** Google Calendar's "add by URL" link for `webcalUrl`. */
  googleUrl: z.string(),
  include: CalendarFeedIncludeSchema,
  createdAt: z.string(),
  /** When a calendar last fetched it (noted at most once an hour); null before the first fetch. */
  lastFetchedAt: z.string().nullable(),
});
export type CalendarFeed = z.infer<typeof CalendarFeedSchema>;

/** `GET`, `PUT` and `POST …/rotate` answer `{ feed }`; `GET` gives null before any feed. */
export const CalendarFeedAnswerSchema = z.object({ feed: CalendarFeedSchema.nullable() });
export type CalendarFeedAnswer = z.infer<typeof CalendarFeedAnswerSchema>;

export const CALENDAR_FEED_LIMITS = {
  /** Rows each source gives at most, in date order from the window start. */
  rowsPerSource: 1000,
  /** The window: days back and days ahead of today. */
  pastDays: 30,
  aheadDays: 365,
  /** A call's length without a Teams meeting. */
  callMinutes: 60,
  /** Characters of a task's or event's description. */
  description: 1000,
  /** PUT and rotate per user and hour. */
  writesPerHour: 20,
  /** The public .ics route per IP and minute, and per token and minute. */
  perIpPerMinute: 60,
  perTokenPerMinute: 20,
} as const;
