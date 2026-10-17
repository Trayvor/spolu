import { and, eq } from 'drizzle-orm';
import type { SessionUser, SourceMeeting } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { canReadItem } from './policy.js';
import { knowledgeItems } from './schema.js';

/**
 * The short form of a meeting other modules show (the task panel's "Meeting: <title>" line), or
 * null. `viewer` reads a task of `groupId` (an admin or a client of that group), so only a meeting
 * of that group answers, and only when the viewer may read it (`canReadItem`): an admins-only
 * meeting never reaches a client. Kept apart from `service.ts` so the tasks module can import it
 * without an import cycle.
 */
export async function getMeetingRef(
  db: Db,
  meetingId: string,
  groupId: string,
  viewer: SessionUser,
): Promise<SourceMeeting | null> {
  const [row] = await db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      visibility: knowledgeItems.visibility,
    })
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.id, meetingId),
        eq(knowledgeItems.groupId, groupId),
        eq(knowledgeItems.type, 'meeting'),
      ),
    );
  if (!row || !canReadItem(viewer, { groupId, visibility: row.visibility }, [groupId])) {
    return null;
  }
  return { id: row.id, title: row.title };
}
