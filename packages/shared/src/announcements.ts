import { z } from 'zod';

/**
 * "What's new" (Novinky, 2026-10-21): a one-time popup about an update, defined in the server's
 * code with a stable id (a date, `2026-10-21`). The server answers the newest announcement with
 * at least one section the person can use, unless they have seen it; the texts are the web's.
 */
export const AnnouncementSectionIds = ['taskSplit', 'snippets', 'bulkEmail', 'finance'] as const;
export const AnnouncementSectionIdSchema = z.enum(AnnouncementSectionIds);
export type AnnouncementSectionId = z.infer<typeof AnnouncementSectionIdSchema>;

export const AnnouncementSchema = z.object({
  id: z.string(),
  /** Only the sections the person can use, in the announcement's order; never empty. */
  sections: z.array(AnnouncementSectionIdSchema).min(1),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** `GET /api/me/announcement`: the one to show now, or null. */
export const CurrentAnnouncementSchema = z.object({ announcement: AnnouncementSchema.nullable() });
export type CurrentAnnouncement = z.infer<typeof CurrentAnnouncementSchema>;
