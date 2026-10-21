import type { AnnouncementSectionId } from '@spolu/shared';

/** An update to tell people about once: a stable id and its sections (the web holds the texts). */
export type AnnouncementDef = {
  /** Stable, never reused: the day of the update (`2026-10-21`). */
  id: string;
  sections: readonly AnnouncementSectionId[];
};

/**
 * Every announcement, **newest first**. A new update adds its entry on top (with its section ids
 * in `AnnouncementSectionIds` and its texts in the web's `whatsNew` namespace); people who saw the
 * previous one then get the new one once.
 */
export const ANNOUNCEMENTS: readonly AnnouncementDef[] = [
  { id: '2026-10-21', sections: ['taskSplit', 'snippets', 'bulkEmail', 'finance'] },
];
