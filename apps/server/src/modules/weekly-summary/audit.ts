import { inArray } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges } from '../audit/diff.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { recordAudit } from '../audit/service.js';
import { weeklySummaries } from './schema.js';

/**
 * The audit rows of the weekly summaries (2026-10-19): a send (`weekly_summary.sent`, the week
 * and the recipient count, never the content or an address) and a group's switch
 * (`weekly_summary_setting.updated`, under the group's id). A person's own reminder or
 * unsubscribe is a personal setting and is not recorded (product/audit-log.md).
 */

export async function recordSummarySent(
  tx: Db,
  by: AuditActor,
  summary: { id: string; groupId: string; week: string },
  groupName: string,
  recipients: number,
): Promise<void> {
  await recordAudit(tx, by, [
    {
      entityType: 'weekly_summary',
      entityId: summary.id,
      entityLabel: `${groupName} ${summary.week}`,
      groupId: summary.groupId,
      action: 'sent',
      changes: diffFields('weekly_summary', null, { week: summary.week, recipients }),
    },
  ]);
}

/** The switch from and to; the same value again records nothing. */
export async function recordSettingChanged(
  tx: Db,
  by: AuditActor,
  group: { id: string; name: string },
  before: boolean,
  after: boolean,
): Promise<void> {
  const changes = diffFields('weekly_summary_setting', { enabled: before }, { enabled: after });
  if (!hasChanges(changes)) return;
  await recordAudit(tx, by, [
    {
      entityType: 'weekly_summary_setting',
      entityId: group.id,
      entityLabel: group.name,
      groupId: group.id,
      action: 'updated',
      changes,
    },
  ]);
}

/** The live-record resolver of `weekly_summary` (registered by `app.ts`). */
export function registerWeeklySummaryAuditResolvers(): void {
  registerAuditResolver('weekly_summary', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: weeklySummaries.id })
        .from(weeklySummaries)
        .where(inArray(weeklySummaries.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
