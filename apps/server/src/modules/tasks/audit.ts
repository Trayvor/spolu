import { eq, inArray } from 'drizzle-orm';
import type { AuditRef } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { FieldValues } from '../audit/diff.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { fileNames } from '../files/service.js';
import { projectRefs } from '../projects/refs.js';
import { getUserNames } from '../users/service.js';
import { buckets, taskAssignees, taskAttachments, tasks } from './schema.js';

/**
 * The tasks module's audit rows (spec §3.1): what a task looks like to the log, with the labels
 * of its bucket, people, project, event and files resolved in a fixed number of queries for any
 * number of tasks (the AI split writes many at once). Task time is never part of it.
 */
export type TaskAuditSnapshot = {
  id: string;
  groupId: string;
  title: string;
  bucketKind: string;
  values: FieldValues;
};

/** A bucket's label: a custom column's name, else its kind (`todo`, `done`, `client_review`). */
export const bucketAuditLabel = (b: { kind: string; name: string | null }) =>
  b.kind === 'custom' && b.name ? b.name : b.kind;

export const bucketRef = (b: { id: string; kind: string; name: string | null }): AuditRef => ({
  id: b.id,
  label: bucketAuditLabel(b),
});

/** The tasks as they are now in `db` (the caller's transaction), by id; gone ones left out. */
export async function taskSnapshots(
  db: Db,
  ids: string[],
): Promise<Map<string, TaskAuditSnapshot>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: tasks.id,
      groupId: tasks.groupId,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      urgent: tasks.urgent,
      link: tasks.link,
      projectId: tasks.projectId,
      eventId: tasks.eventId,
      bucketId: buckets.id,
      bucketKind: buckets.kind,
      bucketName: buckets.name,
    })
    .from(tasks)
    .innerJoin(buckets, eq(buckets.id, tasks.bucketId))
    .where(inArray(tasks.id, ids));
  if (rows.length === 0) return new Map();
  const found = rows.map((r) => r.id);
  const [assignees, attachments, refs] = await Promise.all([
    db
      .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(inArray(taskAssignees.taskId, found)),
    db
      .select({ taskId: taskAttachments.taskId, fileId: taskAttachments.fileId })
      .from(taskAttachments)
      .where(inArray(taskAttachments.taskId, found)),
    projectRefs(db, rows),
  ]);
  const [names, files] = await Promise.all([
    getUserNames(
      db,
      assignees.map((a) => a.userId),
    ),
    fileNames(
      db,
      attachments.map((a) => a.fileId),
    ),
  ]);
  return new Map(
    rows.map((r) => {
      const project = refs.project(r.projectId);
      const event = refs.event(r.eventId);
      const values: FieldValues = {
        title: r.title,
        description: r.description,
        dueDate: r.dueDate,
        urgent: r.urgent,
        link: r.link,
        bucket: bucketRef({ id: r.bucketId, kind: r.bucketKind, name: r.bucketName }),
        assignees: assignees
          .filter((a) => a.taskId === r.id)
          .map((a) => ({ id: a.userId, label: names.get(a.userId) ?? a.userId })),
        project: project ? { id: project.id, label: project.name } : null,
        event: event ? { id: event.id, label: event.name } : null,
        files: attachments
          .filter((a) => a.taskId === r.id)
          .map((a) => ({ id: a.fileId, label: files.get(a.fileId) ?? a.fileId })),
      };
      return [
        r.id,
        { id: r.id, groupId: r.groupId, title: r.title, bucketKind: r.bucketKind, values },
      ];
    }),
  );
}

/** The live-record resolvers of `task` and `bucket` (registered by `app.ts`). */
export function registerTasksAuditResolvers(): void {
  registerAuditResolver('task', {
    async existingIds(db, ids) {
      const rows = await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('bucket', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: buckets.id })
        .from(buckets)
        .where(inArray(buckets.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
