import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  Currencies,
  SALARY_LIMITS,
  type Currency,
  type FileInfo,
  type LinkedCost,
  type LinkedDocument,
  type Month,
  type Salary,
  type SalaryBody,
  type SalaryDetail,
  type SalaryPage,
  type SalaryPatch,
  type SalaryTotals,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges, type FieldValues } from '../audit/diff.js';
import { recordAudit } from '../audit/service.js';
import { files } from '../files/schema.js';
import {
  attachFiles,
  deleteDetachedFiles,
  detachFiles,
  fileNames,
  toFileInfo,
} from '../files/service.js';
import { getGroupLabels } from '../groups/service.js';
import { getUserById, getUserNames } from '../users/service.js';
import { FinanceChangedError, FinanceNotFoundError, FinanceValidationError } from './errors.js';
import { lockGroupFinance } from './folders.js';
import { canBePayee } from './policy.js';
import {
  financeCostDocuments,
  financeItems,
  financeSalaries,
  financeSalaryAttachments,
} from './schema.js';
import { monthAfter, monthStart, type MonthRange } from './scope.js';

/**
 * Salaries ("Mzdy", owner request of 2026-10-21, ADR 0065): what the organisation paid an admin
 * for a month, with files and linked finance documents. Only finance admins reach these
 * functions (the salary routes answer 404 to anyone else, `canSeeSalaries`); nothing here checks
 * the actor again. Writes take the organisation's finance lock, like its items, and record the
 * audit log (`salary`, category finance) in the same transaction.
 *
 * Document links (`finance_cost_documents`) are here too: a finance document linked to a salary
 * or to an expense (an organisation's item of type `expense`).
 */

export type SalaryFilter = {
  /** One admin's salaries; absent: every admin's. */
  admin?: string;
  /** Months from–to (inclusive); absent: every month. */
  range?: MonthRange;
  /** The `nextCursor` of the previous page. */
  after?: string;
};

/** A cursor the server did not make (400). */
export class InvalidSalaryCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidSalaryCursorError';
  }
}

/** A document that is not a finance document, or a link over the limit (400). */
export class InvalidDocumentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentLinkError';
  }
}

const iso = (expr: SQL) =>
  sql`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type SalaryRow = {
  id: string;
  payee_id: string;
  month: Month;
  amount_minor: string;
  currency: Currency;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  file_count: number;
  document_count: number;
};

const CURSOR = /^(\d{4}-(0[1-9]|1[0-2]))\|([\w-]{1,64})$/;

function decodeCursor(cursor: string): { month: Month; id: string } {
  const match = CURSOR.exec(Buffer.from(cursor, 'base64url').toString());
  if (!match) throw new InvalidSalaryCursorError();
  return { month: match[1]!, id: match[3]! };
}

const encodeCursor = (month: Month, id: string) =>
  Buffer.from(`${month}|${id}`).toString('base64url');

/** The filter's condition on `finance_salaries s` (the list and the totals). */
function filterWhere(filter: SalaryFilter): SQL {
  const parts: SQL[] = [sql`true`];
  if (filter.admin) parts.push(sql`s.payee_id = ${filter.admin}`);
  if (filter.range) {
    parts.push(
      sql`s.month >= ${monthStart(filter.range.from)} and s.month < ${monthAfter(filter.range.to)}`,
    );
  }
  return sql.join(parts, sql` and `);
}

/**
 * One page of the list, newest month first (`month desc, id desc`, the month index or, with an
 * admin, the admin's index); counts by primary-key and unique-index lookups per row.
 */
export function salaryPageSql(filter: SalaryFilter, limit: number): SQL {
  const parts = [filterWhere(filter)];
  if (filter.after) {
    const { month, id } = decodeCursor(filter.after);
    parts.push(sql`(s.month, s.id) < (${monthStart(month)}::date, ${id})`);
  }
  return salaryRowsSql(sql.join(parts, sql` and `), limit);
}

function salaryRowsSql(where: SQL, limit: number): SQL {
  return sql`
    select s.id, s.payee_id, to_char(s.month, 'YYYY-MM') as month,
           s.amount_minor::text as amount_minor, s.currency, s.note, s.created_by,
           ${iso(sql`s.created_at`)} as created_at, ${iso(sql`s.updated_at`)} as updated_at,
           (select count(*)::int from finance_salary_attachments a where a.salary_id = s.id)
             as file_count,
           (select count(*)::int from finance_cost_documents d where d.salary_id = s.id)
             as document_count
    from finance_salaries s
    where ${where}
    order by s.month desc, s.id desc
    limit ${limit}`;
}

function toSalary(row: SalaryRow, names: Map<string, string>): Salary {
  return {
    id: row.id,
    payeeId: row.payee_id,
    payeeName: names.get(row.payee_id) ?? '',
    month: row.month,
    amount: { amountMinor: Number(row.amount_minor), currency: row.currency },
    note: row.note,
    fileCount: row.file_count,
    documentCount: row.document_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The totals of a filter: per currency, per admin and currency, per month and currency. */
export function salaryTotalsSql(filter: SalaryFilter): SQL {
  return sql`
    select grouping(s.payee_id) = 0 as by_admin, grouping(s.month) = 0 as by_month,
           s.payee_id, to_char(s.month, 'YYYY-MM') as month, s.currency,
           sum(s.amount_minor)::text as amount, count(*)::int as count
    from finance_salaries s
    where ${filterWhere(filter)}
    group by grouping sets ((s.currency), (s.payee_id, s.currency), (s.month, s.currency))`;
}

const currencyOrder = (c: Currency) => Currencies.indexOf(c);

export async function salaryTotals(db: Db, filter: SalaryFilter): Promise<SalaryTotals> {
  const rows = [
    ...(await db.execute<{
      by_admin: boolean;
      by_month: boolean;
      payee_id: string | null;
      month: Month | null;
      currency: Currency;
      amount: string;
      count: number;
    }>(salaryTotalsSql(filter))),
  ];
  const names = await getUserNames(
    db,
    rows.flatMap((r) => (r.by_admin && r.payee_id ? [r.payee_id] : [])),
  );
  const money = (r: (typeof rows)[number]) => ({
    amountMinor: Number(r.amount),
    currency: r.currency,
  });
  return {
    total: rows
      .filter((r) => !r.by_admin && !r.by_month)
      .sort((a, b) => currencyOrder(a.currency) - currencyOrder(b.currency))
      .map((r) => ({ ...money(r), count: r.count })),
    byAdmin: rows
      .filter((r) => r.by_admin)
      .map((r) => ({
        payeeId: r.payee_id!,
        payeeName: names.get(r.payee_id!) ?? '',
        amount: money(r),
        count: r.count,
      }))
      .sort(
        (a, b) =>
          currencyOrder(a.amount.currency) - currencyOrder(b.amount.currency) ||
          b.amount.amountMinor - a.amount.amountMinor ||
          a.payeeName.localeCompare(b.payeeName),
      ),
    byMonth: rows
      .filter((r) => r.by_month)
      .map((r) => ({ month: r.month!, amount: money(r) }))
      .sort(
        (a, b) =>
          b.month.localeCompare(a.month) ||
          currencyOrder(a.amount.currency) - currencyOrder(b.amount.currency),
      ),
  };
}

/** A page of salaries; the totals of the whole filter on the first page only. */
export async function listSalaries(db: Db, filter: SalaryFilter): Promise<SalaryPage> {
  const size = SALARY_LIMITS.pageSize;
  const rows = [...(await db.execute<SalaryRow>(salaryPageSql(filter, size + 1)))];
  const page = rows.slice(0, size);
  const [names, totals] = await Promise.all([
    getUserNames(
      db,
      page.map((r) => r.payee_id),
    ),
    filter.after ? Promise.resolve(null) : salaryTotals(db, filter),
  ]);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => toSalary(r, names)),
    nextCursor: rows.length > size && last ? encodeCursor(last.month, last.id) : null,
    totals,
  };
}

async function salaryFiles(db: Db, id: string): Promise<FileInfo[]> {
  const rows = await db
    .select({ file: files })
    .from(financeSalaryAttachments)
    .innerJoin(files, eq(files.id, financeSalaryAttachments.fileId))
    .where(eq(financeSalaryAttachments.salaryId, id))
    .orderBy(files.createdAt, files.id);
  return rows.map((r) => toFileInfo(r.file));
}

/** The finance documents linked to a salary or an expense, by title. */
export async function costDocuments(
  db: Db,
  target: { salaryId: string } | { expenseId: string },
): Promise<LinkedDocument[]> {
  const rows = await db
    .select({ id: financeItems.id, title: financeItems.title, groupId: financeItems.groupId })
    .from(financeCostDocuments)
    .innerJoin(financeItems, eq(financeItems.id, financeCostDocuments.documentId))
    .where(
      'salaryId' in target
        ? eq(financeCostDocuments.salaryId, target.salaryId)
        : eq(financeCostDocuments.expenseId, target.expenseId),
    );
  const labels = await getGroupLabels(
    db,
    rows.flatMap((r) => (r.groupId ? [r.groupId] : [])),
  );
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      groupId: r.groupId,
      groupName: r.groupId ? (labels.get(r.groupId)?.name ?? '') : null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

const salaryLabel = (payeeName: string, month: Month) => `${payeeName} · ${month}`;

/** The salaries and expenses a document is linked to (its sheet). */
export async function linkedCosts(db: Db, documentId: string): Promise<LinkedCost[]> {
  const rows = await db
    .select({
      salaryId: financeCostDocuments.salaryId,
      expenseId: financeCostDocuments.expenseId,
    })
    .from(financeCostDocuments)
    .where(eq(financeCostDocuments.documentId, documentId));
  const salaryIds = rows.flatMap((r) => (r.salaryId ? [r.salaryId] : []));
  const expenseIds = rows.flatMap((r) => (r.expenseId ? [r.expenseId] : []));
  const [salaries, expenses] = await Promise.all([
    salaryIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: financeSalaries.id,
            payeeId: financeSalaries.payeeId,
            month: sql<Month>`to_char(${financeSalaries.month}, 'YYYY-MM')`,
          })
          .from(financeSalaries)
          .where(inArray(financeSalaries.id, salaryIds)),
    expenseIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: financeItems.id, title: financeItems.title })
          .from(financeItems)
          .where(inArray(financeItems.id, expenseIds)),
  ]);
  const names = await getUserNames(
    db,
    salaries.map((s) => s.payeeId),
  );
  return [
    ...salaries
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((s) => ({
        kind: 'salary' as const,
        id: s.id,
        label: salaryLabel(names.get(s.payeeId) ?? '', s.month),
      })),
    ...expenses
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => ({ kind: 'expense' as const, id: e.id, label: e.title })),
  ];
}

/** One salary with its files and linked documents, or `FinanceNotFoundError`. */
export async function getSalary(db: Db, id: string): Promise<SalaryDetail> {
  const [row] = [...(await db.execute<SalaryRow>(salaryRowsSql(sql`s.id = ${id}`, 1)))];
  if (!row) throw new FinanceNotFoundError('Salary');
  const [names, salaryFileList, documents] = await Promise.all([
    getUserNames(db, [row.payee_id, row.created_by]),
    salaryFiles(db, id),
    costDocuments(db, { salaryId: id }),
  ]);
  return {
    ...toSalary(row, names),
    files: salaryFileList,
    documents,
    createdByName: names.get(row.created_by) ?? '',
  };
}

type SalaryTableRow = typeof financeSalaries.$inferSelect;

/** A salary as the audit log sees it. */
async function salaryValues(db: Db, row: SalaryTableRow): Promise<FieldValues> {
  const [attachments, documents, people] = await Promise.all([
    db
      .select({ fileId: financeSalaryAttachments.fileId })
      .from(financeSalaryAttachments)
      .where(eq(financeSalaryAttachments.salaryId, row.id)),
    costDocuments(db, { salaryId: row.id }),
    getUserNames(db, [row.payeeId]),
  ]);
  const names = await fileNames(
    db,
    attachments.map((a) => a.fileId),
  );
  return {
    person: { id: row.payeeId, label: people.get(row.payeeId) ?? row.payeeId },
    month: row.month.slice(0, 7),
    amount: { minor: row.amountMinor, currency: row.currency },
    note: row.note,
    files: attachments.map((a) => ({ id: a.fileId, label: names.get(a.fileId) ?? a.fileId })),
    documents: documents.map((d) => ({ id: d.id, label: d.title })),
  };
}

async function recordSalary(
  tx: Db,
  by: AuditActor | undefined,
  action: 'created' | 'updated' | 'deleted',
  row: SalaryTableRow,
  before?: FieldValues,
): Promise<void> {
  if (!by) return;
  const values = await salaryValues(tx, row);
  const changes =
    action === 'created'
      ? diffFields('salary', null, values)
      : action === 'deleted'
        ? diffFields('salary', values, null)
        : diffFields('salary', before ?? {}, values);
  if (action === 'updated' && !hasChanges(changes)) return;
  const person = (values.person as { label: string }).label;
  await recordAudit(tx, by, [
    {
      entityType: 'salary',
      entityId: row.id,
      entityLabel: salaryLabel(person, row.month.slice(0, 7)),
      groupId: null,
      action,
      changes,
    },
  ]);
}

/** Who a salary may pay (decision E4, kept): an active admin or the superadmin. */
async function checkPayee(tx: Db, payeeId: string): Promise<void> {
  const payee = await getUserById(tx, payeeId);
  if (!payee || !canBePayee(payee)) throw new FinanceValidationError('Not an active admin');
}

const selectSalary = async (tx: Db, id: string) =>
  (await tx.select().from(financeSalaries).where(eq(financeSalaries.id, id)))[0];

/** Creates a salary with its finance-only files of the organisation, in one transaction. */
export async function createSalary(
  db: Db,
  actorId: string,
  body: SalaryBody,
  by?: AuditActor,
): Promise<SalaryDetail> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    await checkPayee(tx, body.payeeId);
    const fileIds = [...new Set(body.fileIds)];
    await attachFiles(tx, null, fileIds, actorId, { finance: true });
    await tx.insert(financeSalaries).values({
      id,
      payeeId: body.payeeId,
      month: monthStart(body.month),
      amountMinor: body.amount.amountMinor,
      currency: body.amount.currency,
      note: body.note,
      createdBy: actorId,
    });
    if (fileIds.length > 0) {
      await tx
        .insert(financeSalaryAttachments)
        .values(fileIds.map((fileId) => ({ salaryId: id, fileId })));
    }
    const row = await selectSalary(tx, id);
    if (row) await recordSalary(tx, by, 'created', row);
  });
  return getSalary(db, id);
}

/**
 * Edits a salary: the `updatedAt` check (`FinanceChangedError`), a new admin must be an active
 * one (an old salary of a removed admin keeps them until changed), files attached and detached
 * (the removed ones are deleted after the commit).
 */
export async function updateSalary(
  deps: { db: Db; storage: Storage },
  actorId: string,
  id: string,
  patch: SalaryPatch,
  by?: AuditActor,
): Promise<SalaryDetail> {
  const { db } = deps;
  const removed = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    const [row] = await tx
      .select()
      .from(financeSalaries)
      .where(eq(financeSalaries.id, id))
      .for('update');
    if (!row) throw new FinanceNotFoundError('Salary');
    if (row.updatedAt.getTime() !== Date.parse(patch.updatedAt)) throw new FinanceChangedError();
    const before = by ? await salaryValues(tx, row) : undefined;
    if (patch.payeeId !== undefined && patch.payeeId !== row.payeeId) {
      await checkPayee(tx, patch.payeeId);
    }
    const current = (
      await tx
        .select({ fileId: financeSalaryAttachments.fileId })
        .from(financeSalaryAttachments)
        .where(eq(financeSalaryAttachments.salaryId, id))
    ).map((r) => r.fileId);
    const next = patch.fileIds ? [...new Set(patch.fileIds)] : current;
    const added = next.filter((fileId) => !current.includes(fileId));
    const dropped = current.filter((fileId) => !next.includes(fileId));
    if (added.length > 0) {
      await attachFiles(tx, null, added, actorId, { finance: true });
      await tx
        .insert(financeSalaryAttachments)
        .values(added.map((fileId) => ({ salaryId: id, fileId })));
    }
    if (dropped.length > 0) {
      await tx
        .delete(financeSalaryAttachments)
        .where(
          and(
            eq(financeSalaryAttachments.salaryId, id),
            inArray(financeSalaryAttachments.fileId, dropped),
          ),
        );
      await detachFiles(tx, dropped);
    }
    await tx
      .update(financeSalaries)
      .set({
        payeeId: patch.payeeId ?? row.payeeId,
        month: patch.month ? monthStart(patch.month) : row.month,
        amountMinor: patch.amount?.amountMinor ?? row.amountMinor,
        currency: patch.amount?.currency ?? row.currency,
        note: patch.note ?? row.note,
        updatedAt: sql`now()`,
      })
      .where(eq(financeSalaries.id, id));
    const after = await selectSalary(tx, id);
    if (after) await recordSalary(tx, by, 'updated', after, before);
    return dropped;
  });
  await deleteDetachedFiles(deps, removed).catch(() => undefined);
  return getSalary(db, id);
}

/** Deletes a salary; its files go after the commit, its attachments and links cascade. */
export async function deleteSalary(
  deps: { db: Db; storage: Storage },
  id: string,
  by?: AuditActor,
): Promise<void> {
  const { db } = deps;
  const fileIds = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    const row = await selectSalary(tx, id);
    if (!row) throw new FinanceNotFoundError('Salary');
    const ids = (
      await tx
        .select({ fileId: financeSalaryAttachments.fileId })
        .from(financeSalaryAttachments)
        .where(eq(financeSalaryAttachments.salaryId, id))
    ).map((r) => r.fileId);
    await recordSalary(tx, by, 'deleted', row);
    await tx.delete(financeSalaries).where(eq(financeSalaries.id, id));
    await detachFiles(tx, ids);
    return ids;
  });
  await deleteDetachedFiles(deps, fileIds).catch(() => undefined);
}

export type CostTarget = { kind: 'salary'; id: string } | { kind: 'expense'; id: string };

/** The target's audit row of a link change (a salary's, or the expense's finance item). */
async function recordLink(
  tx: Db,
  by: AuditActor | undefined,
  target: CostTarget,
  document: { id: string; title: string },
  linked: boolean,
): Promise<void> {
  if (!by) return;
  const ref = { id: document.id, label: document.title };
  const changes = {
    documents: linked ? { added: [ref], removed: [] } : { added: [], removed: [ref] },
  };
  if (target.kind === 'salary') {
    const row = await selectSalary(tx, target.id);
    if (!row) return;
    const names = await getUserNames(tx, [row.payeeId]);
    await recordAudit(tx, by, [
      {
        entityType: 'salary',
        entityId: row.id,
        entityLabel: salaryLabel(names.get(row.payeeId) ?? row.payeeId, row.month.slice(0, 7)),
        groupId: null,
        action: 'updated',
        changes,
      },
    ]);
    return;
  }
  const [item] = await tx
    .select({ title: financeItems.title })
    .from(financeItems)
    .where(eq(financeItems.id, target.id));
  await recordAudit(tx, by, [
    {
      entityType: 'finance_item',
      entityId: target.id,
      entityLabel: item?.title ?? 'expense',
      groupId: null,
      action: 'updated',
      changes,
    },
  ]);
}

/** The target exists (a salary, or an item of type `expense`), else `FinanceNotFoundError`. */
async function checkTarget(tx: Db, target: CostTarget): Promise<void> {
  if (target.kind === 'salary') {
    if (!(await selectSalary(tx, target.id))) throw new FinanceNotFoundError('Salary');
    return;
  }
  const [item] = await tx
    .select({ type: financeItems.type })
    .from(financeItems)
    .where(eq(financeItems.id, target.id));
  if (!item || item.type !== 'expense') throw new FinanceNotFoundError('Expense');
}

const targetColumn = (target: CostTarget) =>
  target.kind === 'salary'
    ? eq(financeCostDocuments.salaryId, target.id)
    : eq(financeCostDocuments.expenseId, target.id);

/**
 * Links a finance document to a salary or an expense (idempotent: a second link changes
 * nothing). Only an item of type `document` (any client's or the organisation's) links; at most
 * `SALARY_LIMITS.documentsPerItem` per salary or expense. Returns whether a link was made.
 */
export async function linkDocument(
  db: Db,
  target: CostTarget,
  documentId: string,
  by?: AuditActor,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    await checkTarget(tx, target);
    const [document] = await tx
      .select({ id: financeItems.id, title: financeItems.title, type: financeItems.type })
      .from(financeItems)
      .where(eq(financeItems.id, documentId));
    if (!document) throw new FinanceNotFoundError('Document');
    if (document.type !== 'document') {
      throw new InvalidDocumentLinkError('Only a finance document can be linked');
    }
    const links = await tx
      .select({ documentId: financeCostDocuments.documentId })
      .from(financeCostDocuments)
      .where(targetColumn(target));
    if (links.some((l) => l.documentId === documentId)) return false;
    if (links.length >= SALARY_LIMITS.documentsPerItem) {
      throw new InvalidDocumentLinkError('Too many documents');
    }
    await tx.insert(financeCostDocuments).values({
      id: randomUUID(),
      documentId,
      salaryId: target.kind === 'salary' ? target.id : null,
      expenseId: target.kind === 'expense' ? target.id : null,
    });
    await recordLink(tx, by, target, document, true);
    return true;
  });
}

/** Removes a link (none: `FinanceNotFoundError`). */
export async function unlinkDocument(
  db: Db,
  target: CostTarget,
  documentId: string,
  by?: AuditActor,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    const gone = await tx
      .delete(financeCostDocuments)
      .where(and(targetColumn(target), eq(financeCostDocuments.documentId, documentId)))
      .returning({ id: financeCostDocuments.id });
    if (gone.length === 0) throw new FinanceNotFoundError('Link');
    const [document] = await tx
      .select({ id: financeItems.id, title: financeItems.title })
      .from(financeItems)
      .where(eq(financeItems.id, documentId));
    if (document) await recordLink(tx, by, target, document, false);
  });
}

/** Whether these ids are salaries (the audit log's links). */
export async function existingSalaryIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: financeSalaries.id })
    .from(financeSalaries)
    .where(inArray(financeSalaries.id, ids));
  return new Set(rows.map((r) => r.id));
}
