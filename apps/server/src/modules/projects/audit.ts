import { inArray } from 'drizzle-orm';
import type { AuditChanges } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import type { AuditEntry } from '../audit/service.js';
import { projectEvents, projects } from './schema.js';

/** The projects module's audit rows (spec §3.1): `project` and `project_event`. */
export function projectEntry(
  p: { id: string; groupId: string; name: string },
  action: 'created' | 'updated' | 'status_changed' | 'merged' | 'alias_removed' | 'deleted',
  changes: AuditChanges = {},
): AuditEntry {
  return {
    entityType: 'project',
    entityId: p.id,
    entityLabel: p.name,
    groupId: p.groupId,
    action,
    changes,
  };
}

export function eventEntry(
  e: { id: string; groupId: string; name: string },
  action: 'created' | 'updated' | 'deleted',
  changes: AuditChanges = {},
): AuditEntry {
  return {
    entityType: 'project_event',
    entityId: e.id,
    entityLabel: e.name,
    groupId: e.groupId,
    action,
    changes,
  };
}

/** A project's audited fields. */
export const projectValues = (p: { name: string; description: string }) => ({
  name: p.name,
  description: p.description,
});

/** An event's audited fields (`date` is its day). */
export const eventValues = (e: { name: string; description: string; occursOn: string }) => ({
  name: e.name,
  date: e.occursOn,
  description: e.description,
});

export function registerProjectsAuditResolvers(): void {
  registerAuditResolver('project', {
    async existingIds(db: Db, ids) {
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('project_event', {
    async existingIds(db: Db, ids) {
      const rows = await db
        .select({ id: projectEvents.id })
        .from(projectEvents)
        .where(inArray(projectEvents.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
