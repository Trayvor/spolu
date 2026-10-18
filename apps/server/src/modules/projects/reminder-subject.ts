import { inArray } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { registerReminderSubject, type SubjectInfo } from '../reminders/subjects.js';
import { canReadProjects } from './policy.js';
import { projectEvents } from './schema.js';

/**
 * Project events as reminder subjects (F15): everyone who reads the group (admins and its
 * clients, `canReadProjects`) reads, edits and subscribes to an event's reminders; a žiadateľ
 * never reaches them. Recipients are the group's people, as for a task. The times are edited on
 * their own (`PUT /api/project-events/:id/reminders`), and a notification opens the event sheet
 * on the Prehľad tab. Deleting the event deletes its reminders (the foreign key cascades).
 */
async function loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> {
  const map = new Map<string, SubjectInfo>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: projectEvents.id,
      groupId: projectEvents.groupId,
      name: projectEvents.name,
      description: projectEvents.description,
      createdBy: projectEvents.createdBy,
    })
    .from(projectEvents)
    .where(inArray(projectEvents.id, ids));
  for (const row of rows) {
    map.set(row.id, {
      groupId: row.groupId,
      title: row.name,
      body: plainExcerpt(row.description, () => undefined, Number.POSITIVE_INFINITY),
      adminsOnly: false,
      active: true,
      // An event from eGrant, or one whose creator was deleted, has none.
      authorId: row.createdBy ?? '',
      link: `/groups/${row.groupId}/overview?event=${row.id}`,
      canRead: (actor, actorGroupIds) => canReadProjects(actor, row.groupId, actorGroupIds),
      // `canEditProjects` is `canReadGroup` (decision 8): whoever reads the event edits it, and
      // every route checks `canRead` first.
      canEdit: () => true,
    });
  }
  return map;
}

/** Registers the `event` kind (endpoints under `/api/project-events/:id/reminders`). Idempotent. */
export function registerEventReminderSubject(): void {
  registerReminderSubject({
    kind: 'event',
    routePrefix: 'project-events',
    loadMany,
    standaloneEdit: true,
    addEditorsAsRecipients: true,
  });
}
