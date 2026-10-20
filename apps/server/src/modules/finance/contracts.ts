import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  Currencies,
  partOf,
  SCHEDULE_LIMITS,
  scheduleProblem,
  schedulePeriods,
  type ContractChoice,
  type ContractLink,
  type ContractLinkInput,
  type ContractPayments,
  type ContractRef,
  type ContractSchedule,
  type Currency,
  type ContractDocument,
  type Month,
  type OverviewExpected,
  type ScheduleInput,
  type ScheduleShape,
  type ScheduleSummary,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { FinanceContractLinkError, FinanceParentError, FinanceScheduleError } from './errors.js';
import type { ShareView } from './policy.js';
import {
  financeContractDocuments,
  financeContractSchedules,
  financeContractShares,
  financeItems,
} from './schema.js';
import { monthAfter, monthStart, scopeSql, type FinanceScope, type MonthRange } from './scope.js';

/**
 * Contracts v2 (owner request of 2026-10-21, ADR 0066): a contract's master ("Rámcová zmluva",
 * one level only), its payment schedule and the documents linked to it, each optionally recording
 * a payment. Called by `documents.ts` inside its write transactions (finance admins only, behind
 * `requireFinance`) and by the overview. Nothing is ever created from a schedule: the expected
 * payments are computed on every read, and a period counts as paid from the linked payments.
 *
 * Client scope (decision C3): a contract's clients are its client, or the clients of its shares.
 * A master covers its contracts: every client of a contract under it is a client of the master,
 * so a client's tab that shows a contract can always show its master. A document links to a
 * contract of its own client, or to a contract of several clients that it (an organisation's
 * document, or one of those clients') belongs to.
 */

type ScheduleRow = typeof financeContractSchedules.$inferSelect;

/**
 * Every write that can change the contract tree (a master set, a contract's shares changed)
 * takes this lock last, after the client's lock and the item's row: the one-level and the client
 * rules read other rows, which only writers holding the same lock change, so no two writes can
 * each pass and together break them (and no row-lock order can deadlock).
 */
export async function lockContractTree(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('finance:contract-tree', 0))`);
}

/** The clients a contract covers: its client, or the clients of its shares. */
async function clientsOf(tx: Db, row: { id: string; groupId: string | null }): Promise<string[]> {
  if (row.groupId !== null) return [row.groupId];
  const rows = await tx
    .select({ groupId: financeContractShares.groupId })
    .from(financeContractShares)
    .where(eq(financeContractShares.itemId, row.id));
  return rows.map((r) => r.groupId);
}

const covers = (outer: readonly string[], inner: readonly string[]) =>
  inner.every((id) => outer.includes(id));

/**
 * Checks a master for a contract (new: `id` null) whose clients are `clients`: an existing
 * contract, not the contract itself, with no master of its own, and covering those clients; the
 * contract itself must not be a master. Takes the tree lock.
 */
export async function checkParent(
  tx: Db,
  child: { id: string | null; clients: readonly string[] },
  parentId: string,
): Promise<void> {
  await lockContractTree(tx);
  if (parentId === child.id) throw new FinanceParentError('A contract cannot be its own master');
  const [parent] = await tx.select().from(financeItems).where(eq(financeItems.id, parentId));
  if (!parent || parent.type !== 'contract') throw new FinanceParentError('No such contract');
  if (parent.parentId !== null) {
    throw new FinanceParentError('A contract under a master cannot be a master');
  }
  if (child.id !== null && (await hasChildren(tx, child.id))) {
    throw new FinanceParentError('A master cannot be under another master');
  }
  if (!covers(await clientsOf(tx, parent), child.clients)) {
    throw new FinanceParentError("The master does not cover the contract's clients");
  }
}

async function hasChildren(tx: Db, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: financeItems.id })
    .from(financeItems)
    .where(eq(financeItems.parentId, id))
    .limit(1);
  return row !== undefined;
}

/**
 * New shares of a contract of several clients keep the tree right: a master still covers each of
 * its contracts' clients, a contract still has only clients of its master. Takes the tree lock.
 */
export async function checkTreeAfterShares(
  tx: Db,
  row: { id: string; parentId: string | null },
  clients: readonly string[],
): Promise<void> {
  await lockContractTree(tx);
  if (row.parentId !== null) {
    const [parent] = await tx.select().from(financeItems).where(eq(financeItems.id, row.parentId));
    if (parent && !covers(await clientsOf(tx, parent), clients)) {
      throw new FinanceParentError("The master does not cover the contract's clients");
    }
  }
  const children = await tx.select().from(financeItems).where(eq(financeItems.parentId, row.id));
  for (const child of children) {
    if (!covers(clients, await clientsOf(tx, child))) {
      throw new FinanceParentError("The master no longer covers a contract's clients");
    }
  }
}

/** The ids of a master's contracts (any view). */
export async function childIds(tx: Db, id: string): Promise<string[]> {
  const rows = await tx
    .select({ id: financeItems.id })
    .from(financeItems)
    .where(eq(financeItems.parentId, id));
  return rows.map((r) => r.id);
}

/** The ids of a contract's linked documents. */
export async function linkedDocumentIds(tx: Db, contractId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: financeContractDocuments.documentId })
    .from(financeContractDocuments)
    .where(eq(financeContractDocuments.contractId, contractId));
  return rows.map((r) => r.id);
}

/** The contract a document is linked to, or null. */
export async function linkedContractId(tx: Db, documentId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: financeContractDocuments.contractId })
    .from(financeContractDocuments)
    .where(eq(financeContractDocuments.documentId, documentId));
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------------------------

function shapeOfInput(schedule: ScheduleInput): ScheduleShape {
  return schedule.frequency === 'dates'
    ? { frequency: 'dates', dates: schedule.dates }
    : {
        frequency: schedule.frequency,
        everyMonths: schedule.everyMonths,
        startsOn: schedule.startsOn,
        endsOn: schedule.endsOn,
      };
}

function shapeOfRow(row: ScheduleRow): ScheduleShape {
  return row.frequency === 'dates'
    ? { frequency: 'dates', dates: row.dates ?? [] }
    : {
        frequency: row.frequency,
        everyMonths: row.everyMonths,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      };
}

const EVERY: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

/** Replaces a contract's schedule (`null`: none). Refuses one that yields no payment or too many. */
export async function writeSchedule(
  tx: Db,
  itemId: string,
  schedule: ScheduleInput | null,
  contractEndsOn: string,
): Promise<void> {
  if (schedule !== null) {
    const problem = scheduleProblem(shapeOfInput(schedule), contractEndsOn);
    if (problem) throw new FinanceScheduleError(`Schedule: ${problem}`);
  }
  await tx.delete(financeContractSchedules).where(eq(financeContractSchedules.itemId, itemId));
  if (schedule === null) return;
  if (schedule.frequency === 'dates') {
    const dates = [...new Set(schedule.dates)].sort();
    await tx.insert(financeContractSchedules).values({
      itemId,
      frequency: 'dates',
      everyMonths: null,
      amountMinor: schedule.amountMinor,
      startsOn: dates[0]!,
      endsOn: dates[dates.length - 1]!,
      dates,
    });
    return;
  }
  await tx.insert(financeContractSchedules).values({
    itemId,
    frequency: schedule.frequency,
    everyMonths: schedule.everyMonths ?? EVERY[schedule.frequency]!,
    amountMinor: schedule.amountMinor,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
    dates: null,
  });
}

/** A contract's end moved: a schedule that runs until it must still yield a payment. */
export async function checkScheduleForEnd(
  tx: Db,
  itemId: string,
  contractEndsOn: string,
): Promise<void> {
  const [row] = await tx
    .select()
    .from(financeContractSchedules)
    .where(eq(financeContractSchedules.itemId, itemId));
  if (!row) return;
  const problem = scheduleProblem(shapeOfRow(row), contractEndsOn);
  if (problem) throw new FinanceScheduleError(`Schedule: ${problem}`);
}

function toSchedule(row: ScheduleRow, currency: Currency): ContractSchedule {
  return {
    frequency: row.frequency,
    everyMonths: row.frequency === 'dates' ? null : row.everyMonths,
    amount: { amountMinor: row.amountMinor, currency },
    startsOn: row.startsOn,
    endsOn: row.frequency === 'dates' ? null : row.endsOn,
    dates: row.frequency === 'dates' ? (row.dates ?? []) : null,
  };
}

/** The audit's one-line description of a schedule (a `value` field): never shown to clients. */
export async function scheduleAuditValue(
  db: Db,
  itemId: string,
  currency: Currency | null,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(financeContractSchedules)
    .where(eq(financeContractSchedules.itemId, itemId));
  if (!row) return null;
  const amount = `${(row.amountMinor / 100).toFixed(2)} ${currency ?? ''}`.trim();
  if (row.frequency === 'dates') return `dates · ${amount} · ${(row.dates ?? []).join(', ')}`;
  const every = row.frequency === 'everyMonths' ? ` ${row.everyMonths}` : '';
  return `${row.frequency}${every} · ${amount} · ${row.startsOn}–${row.endsOn ?? ''}`;
}

// ---------------------------------------------------------------------------------------------
// Document links
// ---------------------------------------------------------------------------------------------

/**
 * Replaces a document's link (`null`: none). The contract must exist and fit the document's owner
 * (decision C3), and a payment is in the contract's currency.
 */
export async function writeContractLink(
  tx: Db,
  doc: { id: string; groupId: string | null },
  link: ContractLinkInput | null,
): Promise<void> {
  if (link !== null) {
    const [contract] = await tx
      .select()
      .from(financeItems)
      .where(eq(financeItems.id, link.contractId));
    if (!contract || contract.type !== 'contract') {
      throw new FinanceContractLinkError('No such contract');
    }
    const fits =
      contract.groupId !== null
        ? contract.groupId === doc.groupId
        : doc.groupId === null || (await clientsOf(tx, contract)).includes(doc.groupId);
    if (!fits) throw new FinanceContractLinkError('A contract of another client');
    if (link.payment && link.payment.amount.currency !== contract.currency) {
      throw new FinanceContractLinkError("A payment in another currency than the contract's");
    }
  }
  await tx.delete(financeContractDocuments).where(eq(financeContractDocuments.documentId, doc.id));
  if (link === null) return;
  await tx.insert(financeContractDocuments).values({
    documentId: doc.id,
    contractId: link.contractId,
    amountMinor: link.payment?.amount.amountMinor ?? null,
    paidOn: link.payment?.paidOn ?? null,
  });
}

/** A document's link as the audit sees it: the contract (a ref), the payment and its day. */
export async function linkAuditValues(
  db: Db,
  documentId: string,
): Promise<{
  contract: { id: string; label: string } | null;
  payment: { minor: number; currency: string } | null;
  paidOn: string | null;
}> {
  const [row] = await db
    .select({
      contractId: financeContractDocuments.contractId,
      amountMinor: financeContractDocuments.amountMinor,
      paidOn: financeContractDocuments.paidOn,
      title: financeItems.title,
      currency: financeItems.currency,
    })
    .from(financeContractDocuments)
    .innerJoin(financeItems, eq(financeItems.id, financeContractDocuments.contractId))
    .where(eq(financeContractDocuments.documentId, documentId));
  if (!row) return { contract: null, payment: null, paidOn: null };
  return {
    contract: { id: row.contractId, label: row.title },
    payment:
      row.amountMinor !== null ? { minor: row.amountMinor, currency: row.currency ?? 'EUR' } : null,
    paidOn: row.paidOn,
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const refColumns = {
  id: financeItems.id,
  groupId: financeItems.groupId,
  title: financeItems.title,
  contractNumber: financeItems.contractNumber,
  startsOn: financeItems.startsOn,
  endsOn: financeItems.endsOn,
};

type RefRow = {
  id: string;
  groupId: string | null;
  title: string;
  contractNumber: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

const toRef = (r: RefRow): ContractRef => ({
  id: r.id,
  groupId: r.groupId,
  title: r.title,
  contractNumber: r.contractNumber,
  startsOn: r.startsOn ?? '',
  endsOn: r.endsOn ?? '',
});

/** In a client's tab only that client's items and the contracts it has a share of. */
function visibleIn(view: ShareView): SQL | undefined {
  if (view.kind === 'finance') return undefined;
  return sql`(${financeItems.groupId} = ${view.groupId} or ${financeItems.id} in (
    select s.item_id from finance_contract_shares s where s.group_id = ${view.groupId}))`;
}

/** The payments a contract's linked documents record. */
async function paymentsOf(
  db: Db,
  contractIds: string[],
): Promise<Map<string, { amountMinor: number; paidOn: string }[]>> {
  const map = new Map<string, { amountMinor: number; paidOn: string }[]>();
  if (contractIds.length === 0) return map;
  const rows = await db
    .select({
      contractId: financeContractDocuments.contractId,
      amountMinor: financeContractDocuments.amountMinor,
      paidOn: financeContractDocuments.paidOn,
    })
    .from(financeContractDocuments)
    .where(
      and(
        inArray(financeContractDocuments.contractId, contractIds),
        sql`${financeContractDocuments.amountMinor} is not null`,
      ),
    );
  for (const row of rows) {
    const list = map.get(row.contractId) ?? [];
    list.push({ amountMinor: row.amountMinor!, paidOn: row.paidOn! });
    map.set(row.contractId, list);
  }
  return map;
}

/**
 * The expected payments of a schedule against the payments, in a view's part (`part`/`whole`: a
 * client's share of a contract of several clients; 1/1 otherwise), as of `today`.
 */
function paymentsSummary(
  schedule: ScheduleRow,
  contractEndsOn: string,
  currency: Currency,
  payments: readonly { amountMinor: number; paidOn: string }[],
  today: string,
  part: number,
  whole: number,
): ContractPayments {
  const scaled = (minor: number) => partOf(minor, part, whole);
  const periods = schedulePeriods(
    { ...shapeOfRow(schedule), amountMinor: scaled(schedule.amountMinor) },
    contractEndsOn,
    payments.map((p) => ({ ...p, amountMinor: scaled(p.amountMinor) })),
    today,
  );
  const money = (amountMinor: number) => ({ amountMinor, currency });
  const due = periods.filter((p) => p.dueOn <= today);
  const coming = periods.filter((p) => p.dueOn > today);
  return {
    periods: periods.map((p) => ({
      dueOn: p.dueOn,
      until: p.until,
      expected: money(p.expected),
      received: money(p.received),
      status: p.status,
    })),
    dueToDate: money(due.reduce((s, p) => s + p.expected, 0)),
    received: money(payments.map((p) => scaled(p.amountMinor)).reduce((s, x) => s + x, 0)),
    upcoming: money(coming.reduce((s, p) => s + p.expected, 0)),
    nextDueOn: coming[0]?.dueOn ?? null,
    unpaidCount: due.filter((p) => p.status === 'unpaid').length,
    partialCount: due.filter((p) => p.status === 'partial').length,
  };
}

/** What a contract's detail adds (ADR 0066). */
export type ContractExtras = {
  parent: ContractRef | null;
  children: ContractRef[];
  schedule: ContractSchedule | null;
  payments: ContractPayments | null;
  documents: ContractDocument[];
};

/**
 * A contract's master, its contracts (those the view shows), its schedule and expected payments,
 * and its linked documents (those the view shows). In a client's view a contract of several
 * clients counts that client's part (`share` of `total`) of the schedule and the payments.
 */
export async function contractExtras(
  db: Db,
  contract: {
    id: string;
    parentId: string | null;
    endsOn: string;
    currency: Currency;
    totalMinor: number;
    shareMinor: number | null;
  },
  view: ShareView,
  today: string,
): Promise<ContractExtras> {
  const [parentRows, childRows, [scheduleRow], docRows, payments] = await Promise.all([
    contract.parentId
      ? db.select(refColumns).from(financeItems).where(eq(financeItems.id, contract.parentId))
      : Promise.resolve([]),
    db
      .select(refColumns)
      .from(financeItems)
      .where(and(eq(financeItems.parentId, contract.id), visibleIn(view)))
      .orderBy(financeItems.startsOn, financeItems.id),
    db
      .select()
      .from(financeContractSchedules)
      .where(eq(financeContractSchedules.itemId, contract.id)),
    db
      .select({
        id: financeItems.id,
        groupId: financeItems.groupId,
        title: financeItems.title,
        amountMinor: financeContractDocuments.amountMinor,
        paidOn: financeContractDocuments.paidOn,
      })
      .from(financeContractDocuments)
      .innerJoin(financeItems, eq(financeItems.id, financeContractDocuments.documentId))
      .where(
        and(
          eq(financeContractDocuments.contractId, contract.id),
          view.kind === 'client' ? eq(financeItems.groupId, view.groupId) : undefined,
        ),
      )
      .orderBy(sql`${financeContractDocuments.paidOn} desc nulls last`, financeItems.id),
    paymentsOf(db, [contract.id]),
  ]);
  const share = contract.shareMinor;
  const [part, whole] = share !== null ? [share, contract.totalMinor] : [1, 1];
  return {
    parent: parentRows[0] ? toRef(parentRows[0]) : null,
    children: childRows.map(toRef),
    schedule: scheduleRow ? toSchedule(scheduleRow, contract.currency) : null,
    payments: scheduleRow
      ? paymentsSummary(
          scheduleRow,
          contract.endsOn,
          contract.currency,
          payments.get(contract.id) ?? [],
          today,
          part,
          whole,
        )
      : null,
    documents: docRows.map((d) => ({
      id: d.id,
      groupId: d.groupId,
      title: d.title,
      payment:
        d.amountMinor !== null && d.paidOn !== null
          ? {
              amount: { amountMinor: d.amountMinor, currency: contract.currency },
              paidOn: d.paidOn,
            }
          : null,
    })),
  };
}

/** A document's link: its contract and the payment it records, or null. */
export async function documentLink(db: Db, documentId: string): Promise<ContractLink | null> {
  const [row] = await db
    .select({
      ...refColumns,
      currency: financeItems.currency,
      amountMinor: financeContractDocuments.amountMinor,
      paidOn: financeContractDocuments.paidOn,
    })
    .from(financeContractDocuments)
    .innerJoin(financeItems, eq(financeItems.id, financeContractDocuments.contractId))
    .where(eq(financeContractDocuments.documentId, documentId));
  if (!row) return null;
  return {
    contract: toRef(row),
    payment:
      row.amountMinor !== null && row.paidOn !== null
        ? { amount: { amountMinor: row.amountMinor, currency: row.currency! }, paidOn: row.paidOn }
        : null,
  };
}

/** Most contracts a picker lists. */
const CHOICES_LIMIT = 200;

/**
 * `GET /api/finance/contract-choices`: the contracts a master picker or a document's contract
 * picker offers — one client's own and those it has a share of (`groupId`), or the organisation's
 * contracts of several clients (null). Newest start first, at most 200.
 */
export async function contractChoices(db: Db, groupId: string | null): Promise<ContractChoice[]> {
  const owner =
    groupId === null
      ? sql`${financeItems.groupId} is null`
      : visibleIn({ kind: 'client', groupId })!;
  const rows = await db
    .select({
      ...refColumns,
      parentId: financeItems.parentId,
      // Qualified by hand: drizzle may print the outer column unqualified inside the subquery.
      hasChildren: sql<boolean>`exists (select 1 from finance_items c
        where c.parent_id = "finance_items"."id")`,
    })
    .from(financeItems)
    .where(and(eq(financeItems.type, 'contract'), owner))
    .orderBy(sql`${financeItems.startsOn} desc`, financeItems.id)
    .limit(CHOICES_LIMIT);
  return rows.map((r) => ({ ...toRef(r), parentId: r.parentId, hasChildren: r.hasChildren }));
}

// ---------------------------------------------------------------------------------------------
// The overview's expected payments
// ---------------------------------------------------------------------------------------------

type ScheduledRow = {
  id: string;
  group_id: string | null;
  title: string;
  currency: Currency;
  ends_on: string;
  total_minor: string | number;
  share_minor: string | number | null;
  frequency: ScheduleRow['frequency'];
  every_months: number | null;
  amount_minor: string | number;
  starts_on: string;
  schedule_ends_on: string | null;
  dates: string[] | string | null;
};

/** Postgres hands a `date[]` back as text (`{2026-01-01,…}`) through `execute`. */
function dateList(value: string[] | string | null): string[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value;
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean);
}

/**
 * The scheduled contracts of a scope, with the part of each a view counts: a client's own
 * contracts whole (`share_minor` null), and a contract of several clients with the sum of the
 * scope's shares of it (every client: all of them, the whole). `project` narrows to a client's
 * contracts of that project (`none`: no project); a contract of several clients has none. Like
 * the contracts' money (`contractMoneyRowsSql`), one branch reads a client's contracts by its
 * index, the other the client's shares by theirs; each finds its schedule by primary key.
 */
export function scheduledContractsSql(scope: FinanceScope, project?: string | 'none'): SQL {
  const projectWhere =
    project === undefined
      ? sql``
      : project === 'none'
        ? sql` and c.project_id is null`
        : sql` and c.project_id = ${project}`;
  const own = sql`
    select c.id, c.group_id, c.title, c.currency, c.ends_on, c.amount_minor,
      null::bigint as share_minor
    from finance_items c
    where c.type = 'contract' and c.group_id is not null
      and ${scopeSql(sql`c.group_id`, scope)}${projectWhere}`;
  // A project filter is one client's: its shares of contracts of several clients count under
  // "no project" only (they name none), as in the contracts' money.
  const shared =
    project !== undefined && project !== 'none'
      ? sql``
      : sql`
    union all
    select c.id, c.group_id, c.title, c.currency, c.ends_on, c.amount_minor,
      sum(s.amount_minor)::bigint as share_minor
    from finance_contract_shares s
    join finance_items c on c.id = s.item_id
    where c.type = 'contract' and c.group_id is null and ${scopeSql(sql`s.group_id`, scope)}
    group by c.id`;
  return sql`
    select x.id, x.group_id, x.title, x.currency, x.ends_on::text as ends_on,
      x.amount_minor as total_minor, x.share_minor,
      sc.frequency, sc.every_months, sc.amount_minor, sc.starts_on::text as starts_on,
      sc.ends_on::text as schedule_ends_on, sc.dates::text[] as dates
    from (${own}${shared}) x
    join finance_contract_schedules sc on sc.item_id = x.id
    order by x.title, x.id`;
}

/**
 * The overview's "očakávané" (ADR 0066): every scheduled contract of the scope, its expected
 * payments due in each month of the range and the payments its linked documents received in it,
 * per currency; and a summary per contract (the next payments, the latest due periods).
 */
export async function expectedOverview(
  db: Db,
  scope: FinanceScope,
  range: MonthRange,
  today: string,
  project?: string | 'none',
): Promise<{ expected: OverviewExpected[]; schedules: ScheduleSummary[] }> {
  if (scope.kind === 'org' || (scope.kind === 'groups' && scope.groupIds.length === 0)) {
    return { expected: [], schedules: [] };
  }
  const rows = [...(await db.execute<ScheduledRow>(scheduledContractsSql(scope, project)))];
  const payments = await paymentsOf(
    db,
    rows.map((r) => r.id),
  );
  const from = monthStart(range.from);
  const until = monthAfter(range.to);
  const byCurrency = new Map<
    Currency,
    { expected: Map<Month, number>; received: Map<Month, number> }
  >();
  const add = (currency: Currency, kind: 'expected' | 'received', day: string, minor: number) => {
    if (day < from || day >= until) return;
    const entry = byCurrency.get(currency) ?? { expected: new Map(), received: new Map() };
    const month = day.slice(0, 7) as Month;
    entry[kind].set(month, (entry[kind].get(month) ?? 0) + minor);
    byCurrency.set(currency, entry);
  };
  const schedules: ScheduleSummary[] = [];
  for (const row of rows) {
    const schedule: ScheduleRow = {
      itemId: row.id,
      frequency: row.frequency,
      everyMonths: row.every_months,
      amountMinor: Number(row.amount_minor),
      startsOn: row.starts_on,
      endsOn: row.schedule_ends_on,
      dates: dateList(row.dates),
    };
    const total = Number(row.total_minor);
    const [part, whole] =
      row.group_id === null && scope.kind !== 'all'
        ? [Number(row.share_minor ?? 0), total]
        : [1, 1];
    const summary = paymentsSummary(
      schedule,
      row.ends_on,
      row.currency,
      payments.get(row.id) ?? [],
      today,
      part,
      whole,
    );
    for (const p of summary.periods) add(row.currency, 'expected', p.dueOn, p.expected.amountMinor);
    for (const p of payments.get(row.id) ?? []) {
      add(row.currency, 'received', p.paidOn, partOf(p.amountMinor, part, whole));
    }
    const due = summary.periods.filter((p) => p.dueOn <= today);
    schedules.push({
      contractId: row.id,
      groupId: row.group_id,
      title: row.title,
      frequency: row.frequency,
      everyMonths: row.frequency === 'dates' ? null : row.every_months,
      amount: { amountMinor: partOf(schedule.amountMinor, part, whole), currency: row.currency },
      upcoming: summary.periods
        .filter((p) => p.dueOn > today)
        .slice(0, SCHEDULE_LIMITS.upcoming)
        .map((p) => ({ dueOn: p.dueOn, expected: p.expected })),
      recent: due.slice(-SCHEDULE_LIMITS.recent).map((p) => ({
        dueOn: p.dueOn,
        expected: p.expected,
        received: p.received,
        status: p.status,
      })),
      unpaidCount: summary.unpaidCount,
      partialCount: summary.partialCount,
    });
  }
  const expected = Currencies.flatMap((currency): OverviewExpected[] => {
    const entry = byCurrency.get(currency);
    if (!entry) return [];
    const months = [...new Set([...entry.expected.keys(), ...entry.received.keys()])].sort();
    const byMonth = months.map((month) => ({
      month,
      expected: entry.expected.get(month) ?? 0,
      received: entry.received.get(month) ?? 0,
    }));
    return [
      {
        currency,
        expected: byMonth.reduce((s, m) => s + m.expected, 0),
        received: byMonth.reduce((s, m) => s + m.received, 0),
        byMonth,
      },
    ];
  });
  return { expected, schedules };
}
