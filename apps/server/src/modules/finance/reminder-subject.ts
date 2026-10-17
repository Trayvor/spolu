import { inArray } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { registerReminderSubject, type SubjectInfo } from '../reminders/subjects.js';
import { financeHoldersAmong } from '../users/service.js';
import { emitFinanceChanged } from './events.js';
import { canSeeFinance } from './policy.js';
import { financeItems } from './schema.js';

/**
 * Finance items as reminder subjects (Phase 32 part B, spec §2.3): a contract's reminders. Only
 * finance admins read, edit or receive them: `canRead` and `canEdit` are `canSeeFinance`, and
 * `filterRecipients` keeps finance admins only when recipients are added, when someone subscribes
 * and when a time fires (a right removed meanwhile). Their notifications are in the `finance`
 * group (`notificationGroupOf`). Times are edited on their own (`PUT /api/finance-items/:id/reminders`).
 */
async function loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> {
  const map = new Map<string, SubjectInfo>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: financeItems.id,
      groupId: financeItems.groupId,
      title: financeItems.title,
      body: financeItems.body,
      endsOn: financeItems.endsOn,
      createdBy: financeItems.createdBy,
    })
    .from(financeItems)
    .where(inArray(financeItems.id, ids));
  for (const row of rows) {
    map.set(row.id, {
      groupId: row.groupId,
      title: row.title,
      body: plainExcerpt(row.body, () => undefined, Number.POSITIVE_INFINITY),
      adminsOnly: true,
      active: true,
      authorId: row.createdBy,
      endsOn: row.endsOn,
      link: `/groups/${row.groupId}/finance?item=${row.id}`,
      canRead: (actor) => canSeeFinance(actor),
      canEdit: (actor) => canSeeFinance(actor),
    });
  }
  return map;
}

/** Registers the `finance` kind (endpoints under `/api/finance-items/:id/reminders`). Idempotent. */
export function registerFinanceReminderSubject(): void {
  registerReminderSubject({
    kind: 'finance',
    routePrefix: 'finance-items',
    loadMany,
    standaloneEdit: true,
    addEditorsAsRecipients: true,
    filterRecipients: financeHoldersAmong,
    // The Documents card's bell: its clients' finance admins refetch.
    onTimesChanged: async ({ db, io }, ids) => {
      const rows = await db
        .selectDistinct({ groupId: financeItems.groupId })
        .from(financeItems)
        .where(inArray(financeItems.id, ids));
      for (const row of rows) emitFinanceChanged(io, row.groupId, 'items');
    },
  });
}
