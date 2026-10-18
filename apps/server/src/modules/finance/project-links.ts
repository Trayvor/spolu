import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { onProjectMerge, type ProjectMerge } from '../projects/merge-hooks.js';
import { getProjectRef, InvalidProjectError } from '../projects/refs.js';
import { financeItems, financeTimeEntries as entries } from './schema.js';

/**
 * Finance by project and event (Phase 33 part P6, spec §11, decision 25): time entries keep their
 * own copy of their task's or ticket's `project_id` and `event_id`, so finance never reads
 * `tasks` or `tickets`, and the projects module never reads finance. The completion hooks
 * (`onTaskCompleted`, `onTicketResolved`) and the own-time writes copy the pair; the hooks here
 * keep it in step afterwards. A deleted project or event leaves its ids (no foreign key): the
 * filters no longer offer it.
 */

export { InvalidProjectError };

/** A task's or ticket's project or event changed (`projectId: null` clears both). */
export type SubjectProjectChange = {
  kind: 'task' | 'ticket';
  id: string;
  projectId: string | null;
  eventId: string | null;
};

/**
 * Called by the tasks and tickets modules inside the write's transaction when a task's or a
 * ticket's project or event changes: every entry of the subject (filled or requested) follows.
 * Returns how many entries changed (the caller then tells the finance room). One statement on
 * `finance_time_entries_task_idx` / `…_ticket_user_unique`.
 */
export async function onSubjectProjectChanged(
  tx: Db,
  change: SubjectProjectChange,
): Promise<number> {
  const subject =
    change.kind === 'task' ? eq(entries.taskId, change.id) : eq(entries.ticketId, change.id);
  const rows = await tx
    .update(entries)
    .set({ projectId: change.projectId, eventId: change.projectId ? change.eventId : null })
    .where(
      and(
        subject,
        sql`(${entries.projectId}, ${entries.eventId}) is distinct from
          (${change.projectId}::text, ${change.projectId ? change.eventId : null}::text)`,
      ),
    )
    .returning({ id: entries.id });
  return rows.length;
}

/**
 * A merge of `fromProjectId` into `intoProjectId` of one client (part P3's `mergeProjects`
 * runs it through `runProjectMergeHooks`): the client's entries and contracts of the merged
 * project name the survivor; event ids stay (the events move with their rows).
 */
async function onProjectMerged(tx: Db, merge: ProjectMerge): Promise<void> {
  await tx
    .update(entries)
    .set({ projectId: merge.intoProjectId })
    .where(and(eq(entries.groupId, merge.groupId), eq(entries.projectId, merge.fromProjectId)));
  await tx
    .update(financeItems)
    .set({ projectId: merge.intoProjectId })
    .where(
      and(
        eq(financeItems.groupId, merge.groupId),
        eq(financeItems.projectId, merge.fromProjectId),
        eq(financeItems.type, 'contract'),
      ),
    );
}

/** Registers the merge hook with the projects module; called once at start-up (`app.ts`). */
export function registerFinanceProjectHooks(): void {
  onProjectMerge(onProjectMerged);
}

/**
 * A manual entry's or a contract's pair in its client, through the projects module's exported
 * check (`InvalidProjectError` → `400 invalid_project`). An entry without a client takes none.
 */
export async function checkFinanceProject(
  tx: Db,
  groupId: string | null,
  projectId: string | null,
  eventId: string | null,
): Promise<{ projectId: string | null; eventId: string | null }> {
  if (projectId === null && eventId === null) return { projectId: null, eventId: null };
  if (groupId === null) throw new InvalidProjectError();
  const ref = await getProjectRef(tx, groupId, projectId, eventId);
  return { projectId: ref?.projectId ?? null, eventId: ref?.eventId ?? null };
}
