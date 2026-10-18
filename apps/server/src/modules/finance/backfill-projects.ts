import { and, asc, gt, isNull, or, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { projectOfTasks } from '../tasks/project-links.js';
import { projectOfTickets } from '../tickets/project-links.js';
import { financeBackfills, financeTimeEntries as entries } from './schema.js';

/**
 * The startup job `finance.backfill-projects` (Phase 33 part P6, spec §11): time entries made
 * before migration 0045 get their task's or ticket's project and event. A backfill inside the
 * migration would read `tasks` and `tickets`, which finance never does (decision 25), so this
 * job asks those modules (`projectOfTasks`, `projectOfTickets`) in batches and writes the copies.
 *
 * Idempotent: it writes only entries still without a project (never a copy the hooks wrote since)
 * and leaves a done mark in `finance_backfills`, so later starts skip it. Run in the background
 * by `main.ts` after the server listens; a failure is logged and retried on the next start.
 */
export const BACKFILL_PROJECTS = 'finance.backfill-projects';

type Pair = { projectId: string | null; eventId: string | null };

export async function backfillEntryProjects(
  db: Db,
  options: { batchSize?: number; log?: (message: string) => void } = {},
): Promise<{ skipped: boolean; scanned: number; updated: number }> {
  const batchSize = options.batchSize ?? 500;
  const [done] = await db
    .select({ name: financeBackfills.name })
    .from(financeBackfills)
    .where(sql`${financeBackfills.name} = ${BACKFILL_PROJECTS}`);
  if (done) return { skipped: true, scanned: 0, updated: 0 };

  let scanned = 0;
  let updated = 0;
  let after = '';
  for (;;) {
    // Keyset over the primary key: entries of a task or ticket still without a project.
    const batch = await db
      .select({ id: entries.id, taskId: entries.taskId, ticketId: entries.ticketId })
      .from(entries)
      .where(
        and(
          gt(entries.id, after),
          isNull(entries.projectId),
          or(isNotNull(entries.taskId), isNotNull(entries.ticketId)),
        ),
      )
      .orderBy(asc(entries.id))
      .limit(batchSize);
    if (batch.length === 0) break;
    scanned += batch.length;
    after = batch.at(-1)!.id;

    const [ofTasks, ofTickets] = await Promise.all([
      projectOfTasks(
        db,
        batch.flatMap((r) => (r.taskId ? [r.taskId] : [])),
      ),
      projectOfTickets(
        db,
        batch.flatMap((r) => (r.ticketId ? [r.ticketId] : [])),
      ),
    ]);
    const copies = batch.flatMap((r) => {
      const pair: Pair | undefined = r.taskId
        ? ofTasks.get(r.taskId)
        : r.ticketId
          ? ofTickets.get(r.ticketId)
          : undefined;
      return pair?.projectId ? [{ id: r.id, ...pair }] : [];
    });
    if (copies.length === 0) continue;
    const values = sql.join(
      copies.map((c) => sql`(${c.id}::text, ${c.projectId}::text, ${c.eventId}::text)`),
      sql`, `,
    );
    const rows = await db.execute<{ id: string }>(sql`
      update finance_time_entries t
      set project_id = v.project_id, event_id = v.event_id
      from (values ${values}) as v(id, project_id, event_id)
      where t.id = v.id and t.project_id is null
      returning t.id`);
    updated += [...rows].length;
  }

  await db.insert(financeBackfills).values({ name: BACKFILL_PROJECTS }).onConflictDoNothing();
  options.log?.(`${BACKFILL_PROJECTS}: scanned ${scanned} entries, copied ${updated} projects`);
  return { skipped: false, scanned, updated };
}
