import { eq, inArray } from 'drizzle-orm';
import type { AuditAction, AuditChanges } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges, type FieldValues } from '../audit/diff.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';
import { fileNames } from '../files/service.js';
import { getGroupLabels } from '../groups/service.js';
import { projectRefs } from '../projects/refs.js';
import { getUserNames, listFinanceHolders } from '../users/service.js';
import { costDocuments, existingSalaryIds } from './salaries.js';
import {
  financeAttachments,
  financeContractShares,
  financeFolders,
  financeItems,
  financeRates,
  financeTimeEntries,
} from './schema.js';

/**
 * The finance module's audit rows (spec §3.1, §7): items, folders, time entries and rates, all
 * `category = 'finance'` (from the catalogue), so only finance admins ever read them. Amounts are
 * `money`, minutes `minutes`; an item's note is text (only "changed"). The audit module reads no
 * finance table: finance registers its own resolvers here.
 */

type ItemRow = typeof financeItems.$inferSelect;
type EntryRow = typeof financeTimeEntries.$inferSelect;

/**
 * An item as the log sees it, with its folder's, clients', project's and files' labels, and an
 * expense's linked documents (2026-10-21).
 */
export async function itemValues(db: Db, row: ItemRow): Promise<FieldValues> {
  const [folder, shares, attachments, refs, documents] = await Promise.all([
    row.folderId
      ? db
          .select({ name: financeFolders.name })
          .from(financeFolders)
          .where(eq(financeFolders.id, row.folderId))
      : Promise.resolve([]),
    db
      .select({ groupId: financeContractShares.groupId })
      .from(financeContractShares)
      .where(eq(financeContractShares.itemId, row.id)),
    db
      .select({ fileId: financeAttachments.fileId })
      .from(financeAttachments)
      .where(eq(financeAttachments.itemId, row.id)),
    projectRefs(db, [{ projectId: row.projectId, eventId: null }]),
    row.type === 'expense' ? costDocuments(db, { expenseId: row.id }) : Promise.resolve(null),
  ]);
  const [groups, files] = await Promise.all([
    getGroupLabels(
      db,
      shares.map((s) => s.groupId),
    ),
    fileNames(
      db,
      attachments.map((a) => a.fileId),
    ),
  ]);
  const project = refs.project(row.projectId);
  return {
    title: row.title,
    type: row.type,
    contractNumber: row.contractNumber,
    amount:
      row.amountMinor !== null && row.currency
        ? { minor: row.amountMinor, currency: row.currency }
        : null,
    periodFrom: row.startsOn,
    periodTo: row.endsOn,
    payer: row.payerName,
    shares: shares.map((s) => ({ id: s.groupId, label: groups.get(s.groupId)?.name ?? s.groupId })),
    folder: row.folderId ? { id: row.folderId, label: folder[0]?.name ?? row.folderId } : null,
    project: project ? { id: project.id, label: project.name } : null,
    note: row.body,
    files: attachments.map((a) => ({ id: a.fileId, label: files.get(a.fileId) ?? a.fileId })),
    ...(documents ? { documents: documents.map((d) => ({ id: d.id, label: d.title })) } : {}),
  };
}

const itemLabel = (row: ItemRow) => row.title || row.type;

/** Records an item's `created` (initial values), `updated` (the diff) or `deleted` row. */
export async function recordItem(
  tx: Db,
  by: AuditActor | undefined,
  action: 'created' | 'updated' | 'deleted',
  row: ItemRow,
  before?: FieldValues,
): Promise<void> {
  if (!by) return;
  const values = await itemValues(tx, row);
  const changes =
    action === 'created'
      ? diffFields('finance_item', null, values)
      : action === 'deleted'
        ? diffFields('finance_item', values, null)
        : diffFields('finance_item', before ?? {}, values);
  if (action === 'updated' && !hasChanges(changes)) return;
  await recordAudit(tx, by, [
    {
      entityType: 'finance_item',
      entityId: row.id,
      entityLabel: itemLabel(row),
      // A contract of several clients has none: its clients are its `shares` (spec §3.1).
      groupId: row.groupId,
      action,
      changes,
    },
  ]);
}

export function folderEntry(
  f: { id: string; groupId: string | null; name: string },
  action: 'created' | 'updated' | 'deleted',
  changes: AuditChanges = {},
): AuditEntry {
  return {
    entityType: 'finance_folder',
    entityId: f.id,
    entityLabel: f.name,
    groupId: f.groupId,
    action,
    changes,
  };
}

/** A time entry as the log sees it: whose, how long, which day, of what. */
export async function entryValues(db: Db, row: EntryRow): Promise<FieldValues> {
  const [people, groups, refs] = await Promise.all([
    getUserNames(db, [row.userId]),
    row.groupId ? getGroupLabels(db, [row.groupId]) : Promise.resolve(new Map()),
    projectRefs(db, [{ projectId: row.projectId, eventId: null }]),
  ]);
  const project = refs.project(row.projectId);
  const subject = row.title ?? '';
  return {
    minutes: row.minutes,
    workedOn: row.workedOn,
    person: { id: row.userId, label: people.get(row.userId) ?? row.userId },
    task: row.taskId ? { id: row.taskId, label: subject } : null,
    ticket: row.ticketId ? { id: row.ticketId, label: subject } : null,
    client: row.groupId
      ? { id: row.groupId, label: groups.get(row.groupId)?.name ?? row.groupId }
      : null,
    project: project ? { id: project.id, label: project.name } : null,
    note: row.note,
  };
}

/** Records a time entry's row; `updated` with no change records nothing. */
export async function recordEntry(
  tx: Db,
  by: AuditActor | undefined,
  action: Extract<AuditAction, 'created' | 'updated' | 'deleted'>,
  row: EntryRow,
  before?: FieldValues,
): Promise<void> {
  if (!by) return;
  const values = await entryValues(tx, row);
  const changes =
    action === 'created'
      ? diffFields('time_entry', null, values)
      : action === 'deleted'
        ? diffFields('time_entry', values, null)
        : diffFields('time_entry', before ?? {}, values);
  if (action === 'updated' && !hasChanges(changes)) return;
  const person = (values.person as { label: string }).label;
  await recordAudit(tx, by, [
    {
      entityType: 'time_entry',
      entityId: row.id,
      entityLabel: row.title ? `${person} · ${row.title}` : person,
      groupId: row.groupId,
      action,
      changes,
    },
  ]);
}

export function registerFinanceAuditResolvers(): void {
  registerAuditResolver('finance_item', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: financeItems.id })
        .from(financeItems)
        .where(inArray(financeItems.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('salary', {
    existingIds: (db, ids) => existingSalaryIds(db, ids),
  });
  registerAuditResolver('finance_folder', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: financeFolders.id })
        .from(financeFolders)
        .where(inArray(financeFolders.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('time_entry', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: financeTimeEntries.id })
        .from(financeTimeEntries)
        .where(inArray(financeTimeEntries.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  // The right's row names the admin: linkable while they hold it.
  registerAuditResolver('finance_access', {
    async existingIds(db, ids) {
      const holders = await listFinanceHolders(db);
      return new Set(holders.map((h) => h.id).filter((id) => ids.includes(id)));
    },
  });
  registerAuditResolver('rate', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: financeRates.id })
        .from(financeRates)
        .where(inArray(financeRates.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
