import { sql } from 'drizzle-orm';
import { AUDIT_LIMITS } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

const DAY_MS = 86_400_000;
export const AUDIT_DELETE_BATCH = 5000;

/** The retention job's batch: the oldest `batch` rows before `cutoff`. Exported for EXPLAIN. */
export function oldAuditBatchSql(cutoff: Date, batch: number) {
  return sql`delete from audit_log where id in (
    select id from audit_log where created_at < ${cutoff.toISOString()}::timestamptz
    order by created_at desc nulls last, id desc nulls last limit ${batch})`;
}

/**
 * Deletes the rows older than 730 days before `now` (spec §9), `batch` at a time until none is
 * left, so a backlog never holds a long lock. The number deleted.
 */
export async function deleteOldAudit(
  db: Db,
  now = new Date(),
  batch = AUDIT_DELETE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_LIMITS.retentionDays * DAY_MS);
  let total = 0;
  for (;;) {
    const deleted = (await db.execute(oldAuditBatchSql(cutoff, batch))).count ?? 0;
    total += deleted;
    if (deleted < batch) return total;
  }
}

export const ANONYMIZED_LABEL = 'Vymazaný používateľ';

/**
 * On an erasure request (spec §9; runbook `audit-log-erasure.md`): replaces the person's name as
 * the author of their rows, and the label of their own membership, manager and admin rows. The one
 * sanctioned UPDATE: the trigger allows label changes only inside a transaction that set
 * `spolu.audit_anonymize`. The number of rows changed.
 */
export async function anonymizeActor(
  db: Db,
  userId: string,
  label = ANONYMIZED_LABEL,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local spolu.audit_anonymize = 'on'`);
    const authored = await tx.execute(
      sql`update audit_log set actor_label = ${label} where actor_user_id = ${userId}`,
    );
    const own = await tx.execute(
      sql`update audit_log set entity_label = ${label}
        where (entity_type = 'admin' and entity_id = ${userId})
           or (entity_type in ('membership', 'manager') and entity_id like ${`%:${userId}`})`,
    );
    return (authored.count ?? 0) + (own.count ?? 0);
  });
}
