import { and, eq } from 'drizzle-orm';
import type { Announcement, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientGroupIds } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { ANNOUNCEMENTS, type AnnouncementDef } from './catalogue.js';
import { canSeeAnnouncementSection, type AnnouncementAudience } from './policy.js';
import { announcementSeen } from './schema.js';

/** What the sections are decided on: a client's groups need one query, an admin's none. */
export async function audienceOf(
  db: Db,
  actor: SessionUser,
  taskSplitOn: boolean,
): Promise<AnnouncementAudience> {
  return {
    actor,
    clientGroupIds: isAdmin(actor) ? [] : await clientGroupIds(db, actor.id),
    taskSplitOn,
  };
}

/**
 * The announcement to show the person now: the newest one with a section they can use, with only
 * those sections, unless they have seen it (then null: an older one never comes after a newer
 * one). One primary-key read.
 */
export async function currentAnnouncement(
  db: Db,
  audience: AnnouncementAudience,
  catalogue: readonly AnnouncementDef[] = ANNOUNCEMENTS,
): Promise<Announcement | null> {
  for (const def of catalogue) {
    const sections = def.sections.filter((s) => canSeeAnnouncementSection(s, audience));
    if (sections.length === 0) continue;
    const [row] = await db
      .select({ id: announcementSeen.announcementId })
      .from(announcementSeen)
      .where(
        and(
          eq(announcementSeen.userId, audience.actor.id),
          eq(announcementSeen.announcementId, def.id),
        ),
      );
    return row ? null : { id: def.id, sections };
  }
  return null;
}

/** Records that the person closed the announcement; a repeat is a no-op. False: unknown id. */
export async function markAnnouncementSeen(
  db: Db,
  userId: string,
  id: string,
  catalogue: readonly AnnouncementDef[] = ANNOUNCEMENTS,
): Promise<boolean> {
  if (!catalogue.some((def) => def.id === id)) return false;
  await db.insert(announcementSeen).values({ userId, announcementId: id }).onConflictDoNothing();
  return true;
}
