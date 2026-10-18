import { and, eq, sql } from 'drizzle-orm';
import { KNOWLEDGE_LINKS_MAX, type ProjectDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { InvalidKnowledgeLinkError, linkedItemIds, setLinkedItems } from '../knowledge/links.js';
import { reassignTaskProject } from '../tasks/project-links.js';
import { reassignTicketProject } from '../tickets/project-links.js';
import { ProjectNotFoundError, ProjectValidationError } from './errors.js';
import { runProjectMergeHooks } from './merge-hooks.js';
import { lockGroupProjects } from './refs.js';
import { projectAttachments, projectEvents, projectNameKeys, projects } from './schema.js';
import { getProject } from './service.js';
import type { AuditActor } from '../audit/actor.js';
import { recordAudit } from '../audit/service.js';
import { projectEntry } from './audit.js';

/**
 * Merges project `fromId` into `intoId` of the same client (Phase 33 part P3, spec §5.6), in one
 * transaction under `lockGroupProjects`: events (their tasks and tickets follow through the
 * event FK's `on update cascade`), the other tasks and tickets (`reassignTaskProject`,
 * `reassignTicketProject`), files, linked knowledge, pending eGrant changes and every key row
 * move to the survivor; `runProjectMergeHooks(tx, { groupId, fromProjectId, intoProjectId })`
 * (`merge-hooks.ts`, Phase 33 P6) then moves the copies other modules keep (finance's time
 * entries and contracts); then `fromId` is deleted. The merged project's eGrant id keeps
 * matching the survivor. The caller (`POST /api/projects/:id/merge`) checks
 * `canMergeOrDeleteProject`.
 */
export async function mergeProjects(
  deps: { db: Db; storage: Storage },
  fromId: string,
  intoId: string,
  by?: AuditActor,
): Promise<ProjectDto> {
  const { db } = deps;
  if (fromId === intoId) throw new ProjectValidationError('A project cannot merge into itself');
  const [from] = await db.select().from(projects).where(eq(projects.id, fromId));
  if (!from) throw new ProjectNotFoundError();
  await db.transaction(async (tx) => {
    await lockGroupProjects(tx, from.groupId);
    const rows = await tx
      .select()
      .from(projects)
      .where(sql`${projects.id} in (${fromId}, ${intoId})`)
      .for('update');
    const a = rows.find((r) => r.id === fromId);
    const b = rows.find((r) => r.id === intoId);
    // Another client's project is unknown here, as on every route.
    if (!a || !b || b.groupId !== a.groupId) throw new ProjectNotFoundError();
    const groupId = a.groupId;
    await tx
      .update(projectEvents)
      .set({ projectId: intoId })
      .where(eq(projectEvents.projectId, fromId));
    await reassignTaskProject(tx, groupId, fromId, intoId);
    await reassignTicketProject(tx, groupId, fromId, intoId);
    await tx
      .update(projectAttachments)
      .set({ projectId: intoId })
      .where(eq(projectAttachments.projectId, fromId));
    await moveKnowledge(tx, groupId, fromId, intoId);
    // Pending and dismissed changes: the survivor's own row of a field wins.
    await tx.execute(sql`
      delete from egrant_changes c
      where c.project_id = ${fromId} and exists (
        select 1 from egrant_changes d
        where d.project_id = ${intoId} and d.kind = c.kind
          and coalesce(d.event_id, d.event_key, '') = coalesce(c.event_id, c.event_key, ''))`);
    await tx.execute(
      sql`update egrant_changes set project_id = ${intoId} where project_id = ${fromId}`,
    );
    await tx
      .update(projectNameKeys)
      .set({ projectId: intoId })
      .where(and(eq(projectNameKeys.projectId, fromId), eq(projectNameKeys.groupId, groupId)));
    await tx
      .update(projects)
      .set({
        egrantProjectId: b.egrantProjectId ?? a.egrantProjectId,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, intoId));
    // Other modules' copies of the project id (finance's time entries and contracts, P6).
    await runProjectMergeHooks(tx, { groupId, fromProjectId: fromId, intoProjectId: intoId });
    if (by) {
      // The kept project's `merged`; the absorbed one's deletion is its consequence.
      const [causeId] = await recordAudit(tx, by, [
        projectEntry(b, 'merged', { merged: { from: { id: a.id, label: a.name }, to: null } }),
      ]);
      await recordAudit(tx, by, [{ ...projectEntry(a, 'deleted'), causeId: causeId ?? null }]);
    }
    await tx.delete(projects).where(eq(projects.id, fromId));
  });
  return getProject(db, intoId);
}

/**
 * The merged project's attached knowledge joins the survivor's, up to 10. When one of them is no
 * longer shareable, the survivor keeps only its own (a link cannot be re-added then).
 */
async function moveKnowledge(tx: Db, groupId: string, fromId: string, intoId: string) {
  const own = await linkedItemIds(tx, { kind: 'project', id: intoId });
  const theirs = await linkedItemIds(tx, { kind: 'project', id: fromId });
  const merged = [...new Set([...own, ...theirs])].slice(0, KNOWLEDGE_LINKS_MAX);
  if (merged.length === own.length) return;
  try {
    await tx.transaction((sp) =>
      setLinkedItems(sp, { kind: 'project', id: intoId }, groupId, merged),
    );
  } catch (error) {
    if (!(error instanceof InvalidKnowledgeLinkError)) throw error;
  }
}
