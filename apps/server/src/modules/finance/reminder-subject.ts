import { inArray } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { registerReminderSubject, type SubjectInfo } from '../reminders/subjects.js';
import { financeHoldersAmong, getUserNames } from '../users/service.js';
import { emitFinanceChanged } from './events.js';
import { canSeeFinance } from './policy.js';
import { financeItems } from './schema.js';

/**
 * Finance items as reminder subjects (Phase 32 part B, spec §2.3): a contract's reminders, and
 * since part E an expense's. Only finance admins read, edit or receive them: `canRead` and
 * `canEdit` are `canSeeFinance`, and `filterRecipients` keeps finance admins only when recipients
 * are added, when someone subscribes and when a time fires (a right removed meanwhile). Their
 * notifications are in the `finance` group (`notificationGroupOf`) and never carry an amount.
 * An item of the organisation (no client) links to `/finance`; a salary's title is its admin's
 * name (and its own title), marked `salary` so the texts say "Salary: …". Times are edited on
 * their own (`PUT /api/finance-items/:id/reminders`).
 */
async function loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> {
  const map = new Map<string, SubjectInfo>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: financeItems.id,
      groupId: financeItems.groupId,
      type: financeItems.type,
      title: financeItems.title,
      body: financeItems.body,
      startsOn: financeItems.startsOn,
      endsOn: financeItems.endsOn,
      expenseKind: financeItems.expenseKind,
      payeeId: financeItems.payeeId,
      createdBy: financeItems.createdBy,
    })
    .from(financeItems)
    .where(inArray(financeItems.id, ids));
  const payees = await getUserNames(
    db,
    rows.flatMap((r) => (r.payeeId ? [r.payeeId] : [])),
  );
  for (const row of rows) {
    const expense = row.type === 'expense';
    const salary = expense && row.expenseKind === 'salary';
    const payee = row.payeeId ? (payees.get(row.payeeId) ?? '') : '';
    map.set(row.id, {
      groupId: row.groupId,
      title: salary ? [payee, row.title].filter(Boolean).join(' · ') : row.title,
      body: plainExcerpt(row.body, () => undefined, Number.POSITIVE_INFINITY),
      adminsOnly: true,
      active: true,
      authorId: row.createdBy,
      endsOn: expense ? null : row.endsOn,
      dueOn: expense ? row.startsOn : null,
      salary,
      link:
        row.groupId === null
          ? `/finance?item=${row.id}`
          : `/groups/${row.groupId}/finance?item=${row.id}`,
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
    // The Documents card's bell: its clients' finance admins refetch (null: the organisation's).
    onTimesChanged: async ({ db, io }, ids) => {
      const rows = await db
        .selectDistinct({ groupId: financeItems.groupId })
        .from(financeItems)
        .where(inArray(financeItems.id, ids));
      for (const row of rows) emitFinanceChanged(io, row.groupId, 'items');
    },
  });
}
