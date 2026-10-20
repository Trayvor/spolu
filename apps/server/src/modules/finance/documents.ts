import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  FINANCE_LIMITS,
  shareProblem,
  type ContractShare,
  type ContractsPage,
  type Currency,
  type ExpenseKind,
  type FileInfo,
  type FinanceItem,
  type FinanceItemBody,
  type FinanceItemDetail,
  type FinanceItemPage,
  type FinanceItemPatch,
  type FinanceItemType,
  type FinanceOrgItemBody,
  type ShareInput,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { buildSearchText, escapeLike, searchTerms } from '../../infra/text/search.js';
import { files } from '../files/schema.js';
import { attachFiles, deleteDetachedFiles, detachFiles, toFileInfo } from '../files/service.js';
import { adminGroupId } from '../groups/admin-group.js';
import { getGroupLabels } from '../groups/service.js';
import { projectRefs, type ProjectRefLookup } from '../projects/refs.js';
import { getUserNames } from '../users/service.js';
import {
  FinanceAdminGroupShareError,
  FinanceChangedError,
  FinanceNotFoundError,
  FinanceValidationError,
} from './errors.js';
import { folderOfGroup, folderPaths, lockGroupFinance } from './folders.js';
import { sharesVisibleIn, type ShareView } from './policy.js';
import { checkFinanceProject } from './project-links.js';
import { costDocuments, linkedCosts } from './salaries.js';
import { financeAttachments, financeContractShares, financeItems } from './schema.js';
import { monthAfter, monthStart, scopeSql, type FinanceScope, type MonthRange } from './scope.js';
import type { AuditActor } from '../audit/actor.js';
import type { FieldValues } from '../audit/diff.js';
import { itemValues, recordItem } from './audit.js';
import {
  checkParent,
  checkScheduleForEnd,
  checkTreeAfterShares,
  childIds,
  contractExtras,
  documentLink,
  linkedContractId,
  linkedDocumentIds,
  writeContractLink,
  writeSchedule,
} from './contracts.js';
import { financeToday } from './rates.js';

/**
 * Finance items (Phase 32 part B, spec §3.2, §6.1): one client's contracts, documents and notes,
 * and since part E (spec 2026-10-18) the organisation's items without a client: expenses,
 * documents, notes and contracts of several clients (a payer and one share per client). Only
 * finance admins reach these functions (the finance plugin's `requireFinance`); nothing here
 * checks the actor again. D's global ledger and the finance search call `listItems` (or
 * `listContracts`, the same rows with their client) with a `groups`, `all` or `org` scope.
 *
 * A contract of several clients shows in each client's tab (scope `group`) at the top level,
 * with that client's share as its amount and only that share in `contract.shared.shares`
 * (decision E10, `sharesVisibleIn`): the other clients' shares are never read for that view.
 */

export type ListItemsFilter = {
  /** An id: the items directly in that folder; null: the top level; absent: every folder (flat). */
  folderId?: string | null;
  type?: FinanceItemType;
  /** From 2 characters; matched without diacritics on title, number, body and file names. */
  q?: string;
  /** The `nextCursor` of the previous page (of the same sort). */
  after?: string;
  /** `created` (default, newest first); `start`, `end`, `amount` for contracts (part D). */
  sort?: 'created' | 'start' | 'end' | 'amount';
  /** Of `start`, `end`, `amount`: `desc` (default) or `asc`; items without the value come last. */
  dir?: 'asc' | 'desc';
  /** Rows a page, default `FINANCE_LIMITS.pageSize` (30). */
  limit?: number;
  /**
   * Contracts: those whose period overlaps these months (`/finance`'s page period). Expenses:
   * those dated in them (their period is one day).
   */
  period?: MonthRange;
};

type PageRow = {
  id: string;
  group_id: string | null;
  type: FinanceItemType;
  folder_id: string | null;
  title: string;
  contract_number: string | null;
  amount_minor: string | null;
  currency: Currency | null;
  starts_on: string | null;
  ends_on: string | null;
  payer_name: string | null;
  expense_kind: ExpenseKind | null;
  /** A client's contract's project (Phase 33 P6). */
  project_id: string | null;
  /** A contract's master (ADR 0066). */
  parent_id: string | null;
  has_schedule: boolean;
  /** The viewing client's share of a contract of several clients (scope `group` only). */
  share_minor: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  created_text: string;
  file_count: number;
  has_reminder: boolean;
  group_name: string | null;
  has_logo: boolean;
  group_updated: string;
};

const iso = (expr: SQL) =>
  sql`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const SORT_COLUMNS = {
  start: { column: sql`i.starts_on`, cast: sql`date`, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  end: { column: sql`i.ends_on`, cast: sql`date`, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  amount: { column: sql`i.amount_minor`, cast: sql`bigint`, pattern: /^\d{1,19}$/ },
} as const;

const CREATED_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/;

/** A cursor the server did not make (400). */
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

function decodeCursor(cursor: string): { value: string; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString();
  const at = text.lastIndexOf('|');
  if (at < 0) throw new InvalidCursorError();
  const id = text.slice(at + 1);
  if (id.length === 0 || id.length > 100) throw new InvalidCursorError();
  return { value: text.slice(0, at), id };
}

const encodeCursor = (value: string, id: string) =>
  Buffer.from(`${value}|${id}`).toString('base64url');

/** Contracts and expenses always have an amount and a period (the CHECKs). */
const hasMoney = (type: FinanceItemType | undefined) => type === 'contract' || type === 'expense';

/** The order, the keyset condition after `after` and the cursor of a row, for one sort. */
function ordering(filter: ListItemsFilter) {
  const sort = filter.sort ?? 'created';
  if (sort === 'created') {
    return {
      orderBy: sql`i.created_at desc, i.id desc`,
      after: (cursor: string) => {
        const { value, id } = decodeCursor(cursor);
        if (!CREATED_TEXT.test(value)) throw new InvalidCursorError();
        return sql`(i.created_at, i.id) < (${value}::timestamptz, ${id})`;
      },
      cursorOf: (row: PageRow) => encodeCursor(row.created_text, row.id),
    };
  }
  const { column, cast, pattern } = SORT_COLUMNS[sort];
  const asc = filter.dir === 'asc';
  const dir = asc ? sql`asc` : sql`desc`;
  const beyond = asc ? sql`>` : sql`<`;
  const valueOf = (row: PageRow) =>
    sort === 'start' ? row.starts_on : sort === 'end' ? row.ends_on : row.amount_minor;
  return {
    // Contracts (and expenses) always have the value (CHECKs), so their order needs no `nulls
    // last`, and without it `starts_on desc` reads the partial start index backwards (part D).
    orderBy: hasMoney(filter.type)
      ? sql`${column} ${dir}, i.id ${dir}`
      : sql`${column} ${dir} nulls last, i.id ${dir}`,
    after: (cursor: string) => {
      const { value, id } = decodeCursor(cursor);
      // An empty value: the cursor row had none (those come last).
      if (value === '') return sql`(${column} is null and i.id ${beyond} ${id})`;
      if (!pattern.test(value)) throw new InvalidCursorError();
      const v = sql`${value}::${cast}`;
      return sql`(${column} ${beyond} ${v} or (${column} = ${v} and i.id ${beyond} ${id}) or ${column} is null)`;
    },
    cursorOf: (row: PageRow) => encodeCursor(valueOf(row) ?? '', row.id),
  };
}

/** The items shared with these clients: contracts of several clients with a share of theirs. */
function sharedWith(groupCondition: SQL): SQL {
  return sql`i.id = any(array(select s.item_id from finance_contract_shares s where ${groupCondition}))`;
}

/**
 * Which items a scope (and a folder) covers. A client (`group`): its own items, and at its top
 * level and in a flat list the contracts of several clients it has a share of (they sit in no
 * folder of the client). Chosen clients (`groups`): their items and the contracts shared with
 * any of them; never the organisation's own items (decision E14). Every client (`all`): every
 * item, the organisation's too. The organisation (`org`): the items without a client.
 */
function ownerWhere(scope: FinanceScope, folderId: string | null | undefined): SQL {
  const folder =
    folderId === undefined
      ? null
      : folderId === null
        ? sql`i.folder_id is null`
        : sql`i.folder_id = ${folderId}`;
  switch (scope.kind) {
    case 'group': {
      const own = sql`i.group_id = ${scope.groupId}`;
      const shared = sharedWith(sql`s.group_id = ${scope.groupId}`);
      if (folderId === undefined) return sql`(${own} or ${shared})`;
      if (folderId === null) return sql`((${own} and i.folder_id is null) or ${shared})`;
      return sql`${own} and ${folder}`;
    }
    case 'groups': {
      if (scope.groupIds.length === 0) return sql`false`;
      const list = sql.join(
        scope.groupIds.map((id) => sql`${id}`),
        sql`, `,
      );
      const where = sql`(i.group_id in (${list}) or ${sharedWith(sql`s.group_id in (${list})`)})`;
      return folder ? sql`${where} and ${folder}` : where;
    }
    case 'all': {
      // Every client but the admin group unless chosen (Phase 34 part E); the organisation's in.
      const where = scopeSql(sql`i.group_id`, scope);
      return folder ? sql`${where} and ${folder}` : where;
    }
    case 'org':
      return folder ? sql`i.group_id is null and ${folder}` : sql`i.group_id is null`;
  }
}

function filterWhere(scope: FinanceScope, filter: ListItemsFilter): SQL {
  const parts: SQL[] = [ownerWhere(scope, filter.folderId)];
  if (filter.type) parts.push(sql`i.type = ${filter.type}`);
  if (filter.period) {
    // Starts before the period ends and ends on or after its first day.
    parts.push(
      sql`i.starts_on < ${monthAfter(filter.period.to)} and i.ends_on >= ${monthStart(filter.period.from)}`,
    );
  }
  for (const term of searchTerms(filter.q ?? '')) {
    parts.push(sql`i.search_text ilike '%' || ${escapeLike(term)} || '%' escape '\\'`);
  }
  return sql.join(parts, sql` and `);
}

/**
 * The single query of a page and of the detail: items with their client (none for the
 * organisation's), file count and whether a reminder time is still to come; for a client's view
 * (`shareGroup`) that client's share of a contract of several clients. Primary-key joins and one
 * index lookup per row (the attachments' primary key, the reminder set's unique key, the shares'
 * primary key).
 */
function pageQuery(where: SQL, orderBy: SQL, limit: number, shareGroup: string | null): SQL {
  const share = shareGroup
    ? sql`(select s.amount_minor::text from finance_contract_shares s
           where s.item_id = i.id and s.group_id = ${shareGroup})`
    : sql`null::text`;
  return sql`
    select i.id, i.group_id, i.type, i.folder_id, i.title, i.contract_number,
           i.amount_minor::text as amount_minor, i.currency,
           i.starts_on::text as starts_on, i.ends_on::text as ends_on, i.created_by,
           i.payer_name, i.expense_kind, i.project_id, ${share} as share_minor,
           i.parent_id,
           -- A scalar lookup by primary key per row (an exists may turn into a hashed scan).
           (select true from finance_contract_schedules sc where sc.item_id = i.id limit 1)
             is not null as has_schedule,
           ${iso(sql`i.created_at`)} as created_at, ${iso(sql`i.updated_at`)} as updated_at,
           i.created_at::text as created_text,
           (select count(*)::int from finance_attachments a where a.item_id = i.id) as file_count,
           exists (select 1 from reminder_sets s join reminder_times t on t.set_id = s.id
                   where s.finance_item_id = i.id and t.fired_at is null) as has_reminder,
           g.name as group_name, coalesce(g.logo_key is not null, false) as has_logo,
           coalesce(${iso(sql`g.updated_at`)}, '') as group_updated
    from finance_items i
    left join groups g on g.id = i.group_id
    where ${where}
    order by ${orderBy}
    limit ${limit}`;
}

/** What `toItem` needs besides the row: the shares a view shows and the projects. */
type ItemContext = {
  shares: Map<string, ContractShare[]>;
  /** The contracts' projects (Phase 33 P6), through the projects module's `projectRefs`. */
  projects: ProjectRefLookup;
};

/**
 * The shares of these contracts of several clients, by client name, with the clients' names.
 * A client's view reads its own share only (`sharesVisibleIn` filters once more).
 */
async function loadShares(
  db: Db,
  itemIds: string[],
  view: ShareView,
): Promise<Map<string, ContractShare[]>> {
  const map = new Map<string, ContractShare[]>();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({
      itemId: financeContractShares.itemId,
      groupId: financeContractShares.groupId,
      amountMinor: financeContractShares.amountMinor,
    })
    .from(financeContractShares)
    .where(
      and(
        inArray(financeContractShares.itemId, itemIds),
        view.kind === 'client' ? eq(financeContractShares.groupId, view.groupId) : undefined,
      ),
    );
  const labels = await getGroupLabels(
    db,
    rows.map((r) => r.groupId),
  );
  for (const row of sharesVisibleIn(view, rows)) {
    const list = map.get(row.itemId) ?? [];
    list.push({
      groupId: row.groupId,
      groupName: labels.get(row.groupId)?.name ?? '',
      amountMinor: row.amountMinor,
    });
    map.set(row.itemId, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) => a.groupName.localeCompare(b.groupName) || a.groupId.localeCompare(b.groupId),
    );
  }
  return map;
}

async function itemContext(db: Db, rows: PageRow[], view: ShareView): Promise<ItemContext> {
  const sharedIds = rows
    .filter((r) => r.type === 'contract' && r.group_id === null)
    .map((r) => r.id);
  const [shares, projects] = await Promise.all([
    loadShares(db, sharedIds, view),
    projectRefs(
      db,
      rows.flatMap((r) => (r.project_id ? [{ projectId: r.project_id, eventId: null }] : [])),
    ),
  ]);
  return { shares, projects };
}

function toItem(row: PageRow, context: ItemContext): FinanceItem {
  const money =
    row.amount_minor !== null && row.currency !== null
      ? { amountMinor: Number(row.amount_minor), currency: row.currency }
      : null;
  const shared =
    row.type === 'contract' && row.group_id === null
      ? {
          payerName: row.payer_name ?? '',
          total: money!,
          shares: context.shares.get(row.id) ?? [],
        }
      : null;
  // In a client's tab a contract of several clients counts that client's share (decision E10).
  const amount =
    shared && row.share_minor !== null
      ? { amountMinor: Number(row.share_minor), currency: row.currency! }
      : money;
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.type,
    folderId: row.folder_id,
    title: row.title,
    contract:
      row.type === 'contract'
        ? {
            contractNumber: row.contract_number,
            amount: amount!,
            startsOn: row.starts_on!,
            endsOn: row.ends_on!,
            shared,
            project: context.projects.project(row.project_id),
            projectId: row.project_id,
            parentId: row.parent_id,
            hasSchedule: row.has_schedule,
          }
        : null,
    expense:
      row.type === 'expense'
        ? {
            kind: row.expense_kind!,
            amount: money!,
            spentOn: row.starts_on!,
          }
        : null,
    fileCount: row.file_count,
    hasUpcomingReminder: row.has_reminder,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const viewOf = (scope: FinanceScope): ShareView =>
  scope.kind === 'group' ? { kind: 'client', groupId: scope.groupId } : { kind: 'finance' };

const pageSize = (filter: ListItemsFilter) =>
  Math.max(1, Math.min(filter.limit ?? FINANCE_LIMITS.pageSize, 100));

/** The first page's query of `listItems` / `listContracts` (the EXPLAIN checks). */
export function contractsPageSql(scope: FinanceScope, filter: ListItemsFilter): SQL {
  return pageQuery(
    filterWhere(scope, filter),
    ordering(filter).orderBy,
    pageSize(filter) + 1,
    scope.kind === 'group' ? scope.groupId : null,
  );
}

async function runPage(db: Db, scope: FinanceScope, filter: ListItemsFilter) {
  const size = pageSize(filter);
  const order = ordering(filter);
  const where = filterWhere(scope, filter);
  const full = filter.after ? sql`${where} and ${order.after(filter.after)}` : where;
  const shareGroup = scope.kind === 'group' ? scope.groupId : null;
  const rows = [
    ...(await db.execute<PageRow>(pageQuery(full, order.orderBy, size + 1, shareGroup))),
  ];
  const page = rows.slice(0, size);
  // A flat list (a search, a type filter, another scope) names each item's folder.
  const [pathOf, context] = await Promise.all([
    filter.folderId === undefined
      ? folderPaths(
          db,
          page.flatMap((row) => (row.folder_id ? [row.folder_id] : [])),
        )
      : Promise.resolve(null),
    itemContext(db, page, viewOf(scope)),
  ]);
  const items = page.map((row) => {
    const item = toItem(row, context);
    // A shared contract's folder is the organisation's; a client's view names none.
    if (pathOf) {
      item.folderPath =
        row.folder_id && !(shareGroup && row.group_id === null) ? pathOf(row.folder_id) : [];
    }
    return { row, item };
  });
  return {
    items,
    nextCursor: rows.length > size ? order.cursorOf(page[page.length - 1]!) : null,
  };
}

/** One page of items of the scope (the Documents card; part D's search). */
export async function listItems(
  db: Db,
  scope: FinanceScope,
  filter: ListItemsFilter,
): Promise<FinanceItemPage> {
  if (scope.kind === 'groups' && scope.groupIds.length === 0)
    return { items: [], nextCursor: null };
  const { items, nextCursor } = await runPage(db, scope, filter);
  return { items: items.map((x) => x.item), nextCursor };
}

/** `listItems` with each item's client (part D's ledger; '' for the organisation's items). */
export async function listContracts(
  db: Db,
  scope: FinanceScope,
  filter: ListItemsFilter,
): Promise<ContractsPage> {
  if (scope.kind === 'groups' && scope.groupIds.length === 0)
    return { items: [], nextCursor: null };
  const { items, nextCursor } = await runPage(db, scope, filter);
  return {
    items: items.map(({ row, item }) => ({
      ...item,
      groupName: row.group_name ?? '',
      hasLogo: row.has_logo,
      groupUpdatedAt: row.group_updated,
    })),
    nextCursor,
  };
}

async function itemFiles(db: Db, id: string): Promise<FileInfo[]> {
  const rows = await db
    .select({ file: files })
    .from(financeAttachments)
    .innerJoin(files, eq(files.id, financeAttachments.fileId))
    .where(eq(financeAttachments.itemId, id))
    .orderBy(files.createdAt, files.id);
  return rows.map((r) => toFileInfo(r.file));
}

/**
 * One item with its body, files and author's name. On `/finance` (the default view) any item; in
 * a client's view (`?group=`, decision E10) only the client's own items and the contracts of
 * several clients it has a share of, with that share only: anything else is not found.
 */
export async function getItem(
  db: Db,
  id: string,
  view: ShareView = { kind: 'finance' },
): Promise<FinanceItemDetail> {
  const scoped =
    view.kind === 'client'
      ? sql`i.id = ${id} and ${ownerWhere({ kind: 'group', groupId: view.groupId }, undefined)}`
      : sql`i.id = ${id}`;
  const shareGroup = view.kind === 'client' ? view.groupId : null;
  const [row] = [...(await db.execute<PageRow>(pageQuery(scoped, sql`i.id`, 1, shareGroup)))];
  if (!row) throw new FinanceNotFoundError();
  // Document links (2026-10-21) on `/finance` only: a client's view shows none.
  const finance = view.kind === 'finance';
  const [[body], itemFileList, names, context, documents, costs, extras] = await Promise.all([
    db.select({ body: financeItems.body }).from(financeItems).where(eq(financeItems.id, id)),
    itemFiles(db, id),
    getUserNames(db, [row.created_by]),
    itemContext(db, [row], view),
    finance && row.type === 'expense' ? costDocuments(db, { expenseId: id }) : null,
    finance && row.type === 'document' ? linkedCosts(db, id) : null,
    // Contracts v2 (ADR 0066): a contract's master, contracts, schedule and documents; a
    // document's contract.
    row.type === 'contract'
      ? contractExtras(
          db,
          {
            id: row.id,
            parentId: row.parent_id,
            endsOn: row.ends_on!,
            currency: row.currency!,
            totalMinor: Number(row.amount_minor),
            shareMinor:
              row.group_id === null && row.share_minor !== null ? Number(row.share_minor) : null,
          },
          view,
          financeToday(),
        )
      : row.type === 'document'
        ? documentLink(db, row.id).then((contractLink) => ({ contractLink }))
        : Promise.resolve({}),
  ]);
  return {
    ...toItem(row, context),
    body: body?.body ?? '',
    files: itemFileList,
    createdByName: names.get(row.created_by) ?? '',
    ...(documents ? { costDocuments: documents } : {}),
    ...(costs ? { linkedCosts: costs } : {}),
    ...extras,
  };
}

/** The item's owner (`groupId` null: the organisation's), or null for an unknown id. */
async function itemOwner(db: Db, id: string): Promise<{ groupId: string | null } | null> {
  const [row] = await db
    .select({ groupId: financeItems.groupId })
    .from(financeItems)
    .where(eq(financeItems.id, id));
  return row ?? null;
}

/** The clients with a share of the item (none unless it is a contract of several clients). */
async function itemShareGroups(db: Db, id: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: financeContractShares.groupId })
    .from(financeContractShares)
    .where(eq(financeContractShares.itemId, id));
  return rows.map((r) => r.groupId);
}

async function searchTextOf(
  tx: Db,
  input: { title: string; body: string; extra: (string | null)[]; fileIds: string[] },
): Promise<string> {
  const names =
    input.fileIds.length === 0
      ? []
      : await tx.select({ name: files.name }).from(files).where(inArray(files.id, input.fileIds));
  return buildSearchText({
    title: input.title,
    body: input.body,
    url: null,
    fileNames: names.map((f) => f.name),
    nameOf: () => undefined,
    extra: input.extra.filter((x): x is string => !!x),
  });
}

function checkBody(body: string): void {
  if (body.includes('\0')) throw new FinanceValidationError('A body cannot hold a NUL character');
}

/**
 * The shares of a contract of several clients (decisions O1, E8): valid (`shareProblem`) and of
 * existing clients, never the admin group (Phase 34 part E: internal money is no client's
 * share). The schema checked them already; this guards every write.
 */
async function checkShares(tx: Db, totalMinor: number, shares: readonly ShareInput[]) {
  const problem = shareProblem(totalMinor, shares);
  if (problem) throw new FinanceValidationError(`Shares: ${problem}`);
  const labels = await getGroupLabels(
    tx,
    shares.map((s) => s.groupId),
  );
  if (labels.size !== shares.length) throw new FinanceValidationError('Shares: unknown client');
  const admin = await adminGroupId(tx);
  if (admin && shares.some((s) => s.groupId === admin)) throw new FinanceAdminGroupShareError();
}

/** Creates an item of a client with its finance-only files, in one transaction. */
export async function createItem(
  db: Db,
  actorId: string,
  groupId: string,
  body: FinanceItemBody,
  by?: AuditActor,
): Promise<FinanceItemDetail> {
  checkBody(body.body);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const folderId = await folderOfGroup(tx, groupId, body.folderId);
    const fileIds = [...new Set(body.fileIds)];
    // Only finance-only files the actor uploaded to this client, not attached anywhere yet.
    await attachFiles(tx, groupId, fileIds, actorId, { finance: true });
    const contractNumber = body.type === 'contract' ? body.contractNumber : null;
    // ADR 0066: a master of this client (or one of several clients that it is one of).
    if (body.type === 'contract' && body.parentId !== null) {
      await checkParent(tx, { id: null, clients: [groupId] }, body.parentId);
    }
    const counterparts = await counterpartValues(tx, by, [
      body.type === 'contract' ? body.parentId : null,
      body.type === 'document' ? (body.contractLink?.contractId ?? null) : null,
    ]);
    await tx.insert(financeItems).values({
      id,
      groupId,
      type: body.type,
      folderId,
      title: body.title,
      body: body.body,
      ...(body.type === 'contract'
        ? {
            contractNumber,
            amountMinor: body.amount.amountMinor,
            currency: body.amount.currency,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            // Phase 33 P6: one of this client's projects (`InvalidProjectError`, 400).
            projectId: (await checkFinanceProject(tx, groupId, body.projectId, null)).projectId,
            parentId: body.parentId,
          }
        : {}),
      searchText: await searchTextOf(tx, {
        title: body.title,
        body: body.body,
        extra: [contractNumber],
        fileIds,
      }),
      createdBy: actorId,
    });
    if (fileIds.length > 0) {
      await tx.insert(financeAttachments).values(fileIds.map((fileId) => ({ itemId: id, fileId })));
    }
    if (body.type === 'contract') await writeSchedule(tx, id, body.schedule, body.endsOn);
    if (body.type === 'document') await writeContractLink(tx, { id, groupId }, body.contractLink);
    await recordCreated(tx, by, id);
    await recordCounterparts(tx, by, counterparts);
  });
  return getItem(db, id);
}

/**
 * The audit values of the items a write changes besides its own (ADR 0066): a master gains or
 * loses a contract, a contract a document. Read before the change; `recordCounterparts` records
 * each one's `updated` row after it (none when nothing of it changed).
 */
async function counterpartValues(
  tx: Db,
  by: AuditActor | undefined,
  ids: (string | null)[],
): Promise<Map<string, FieldValues>> {
  const map = new Map<string, FieldValues>();
  if (!by) return map;
  const unique = [...new Set(ids.filter((x): x is string => x !== null))];
  if (unique.length === 0) return map;
  const rows = await tx.select().from(financeItems).where(inArray(financeItems.id, unique));
  for (const row of rows) map.set(row.id, await itemValues(tx, row));
  return map;
}

async function recordCounterparts(
  tx: Db,
  by: AuditActor | undefined,
  before: Map<string, FieldValues>,
): Promise<void> {
  if (!by || before.size === 0) return;
  const rows = await tx
    .select()
    .from(financeItems)
    .where(inArray(financeItems.id, [...before.keys()]));
  for (const row of rows) await recordItem(tx, by, 'updated', row, before.get(row.id));
}

/** The item's `created` row, as it was inserted in `tx`. */
async function recordCreated(tx: Db, by: AuditActor | undefined, id: string): Promise<void> {
  if (!by) return;
  const [row] = await tx.select().from(financeItems).where(eq(financeItems.id, id));
  if (row) await recordItem(tx, by, 'created', row);
}

/**
 * Creates an item of the organisation (Phase 32 E) with its finance-only files, in one
 * transaction: a contract of several clients with its payer and shares, an expense (a payment
 * of the organisation; admins' salaries are salary records since 2026-10-21), a document or a
 * note.
 */
export async function createOrgItem(
  db: Db,
  actorId: string,
  body: FinanceOrgItemBody,
  by?: AuditActor,
): Promise<FinanceItemDetail> {
  checkBody(body.body);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await lockGroupFinance(tx, null);
    const folderId = await folderOfGroup(tx, null, body.folderId);
    const fileIds = [...new Set(body.fileIds)];
    await attachFiles(tx, null, fileIds, actorId, { finance: true });
    let columns: Partial<typeof financeItems.$inferInsert> = {};
    let extra: (string | null)[] = [];
    if (body.type === 'contract' && body.parentId !== null) {
      await checkParent(
        tx,
        { id: null, clients: body.shares.map((s) => s.groupId) },
        body.parentId,
      );
    }
    const counterparts = await counterpartValues(tx, by, [
      body.type === 'contract' ? body.parentId : null,
      body.type === 'document' ? (body.contractLink?.contractId ?? null) : null,
    ]);
    if (body.type === 'contract') {
      await checkShares(tx, body.amount.amountMinor, body.shares);
      columns = {
        contractNumber: body.contractNumber,
        amountMinor: body.amount.amountMinor,
        currency: body.amount.currency,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        payerName: body.payerName,
        parentId: body.parentId,
      };
      extra = [body.contractNumber, body.payerName];
    } else if (body.type === 'expense') {
      columns = {
        amountMinor: body.amount.amountMinor,
        currency: body.amount.currency,
        startsOn: body.spentOn,
        endsOn: body.spentOn,
        expenseKind: body.expenseKind,
      };
    }
    await tx.insert(financeItems).values({
      id,
      groupId: null,
      type: body.type,
      folderId,
      title: body.title,
      body: body.body,
      ...columns,
      searchText: await searchTextOf(tx, { title: body.title, body: body.body, extra, fileIds }),
      createdBy: actorId,
    });
    if (body.type === 'contract') {
      await tx
        .insert(financeContractShares)
        .values(
          body.shares.map((s) => ({ itemId: id, groupId: s.groupId, amountMinor: s.amountMinor })),
        );
    }
    if (fileIds.length > 0) {
      await tx.insert(financeAttachments).values(fileIds.map((fileId) => ({ itemId: id, fileId })));
    }
    if (body.type === 'contract') await writeSchedule(tx, id, body.schedule, body.endsOn);
    if (body.type === 'document') {
      await writeContractLink(tx, { id, groupId: null }, body.contractLink);
    }
    await recordCreated(tx, by, id);
    await recordCounterparts(tx, by, counterparts);
  });
  return getItem(db, id);
}

const CONTRACT_KEYS = ['contractNumber', 'startsOn', 'endsOn', 'parentId', 'schedule'] as const;
const SHARED_KEYS = ['payerName', 'shares'] as const;
const EXPENSE_KEYS = ['spentOn'] as const;

/**
 * Edits an item in one transaction: the `updatedAt` check (`FinanceChangedError`); each type's
 * fields only on that type (a contract's number and period, the payer and shares only on a
 * contract of several clients, the date only on an expense); the period kept in order; a new amount or new shares added up again (O1); files
 * attached and detached (the removed ones are deleted after the commit), `search_text`
 * rewritten. Returns the item as `/finance` shows it.
 */
export async function updateItem(
  deps: { db: Db; storage: Storage },
  actorId: string,
  id: string,
  patch: FinanceItemPatch,
  by?: AuditActor,
): Promise<FinanceItemDetail> {
  const { db } = deps;
  const owner = await itemOwner(db, id);
  if (owner === null) throw new FinanceNotFoundError();
  const groupId = owner.groupId;
  if (patch.body !== undefined) checkBody(patch.body);
  const removed = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const [row] = await tx.select().from(financeItems).where(eq(financeItems.id, id)).for('update');
    if (!row) throw new FinanceNotFoundError();
    if (row.updatedAt.getTime() !== Date.parse(patch.updatedAt)) throw new FinanceChangedError();
    const auditBefore = by ? await itemValues(tx, row) : undefined;
    const contract = row.type === 'contract';
    const expense = row.type === 'expense';
    const shared = contract && row.groupId === null;
    const has = (keys: readonly (keyof FinanceItemPatch)[]) =>
      keys.some((key) => patch[key] !== undefined);
    if (!contract && has(CONTRACT_KEYS)) {
      throw new FinanceValidationError('Only a contract has contract fields');
    }
    if (row.type !== 'document' && patch.contractLink !== undefined) {
      throw new FinanceValidationError('Only a document links to a contract');
    }
    if (!contract && !expense && patch.amount !== undefined) {
      throw new FinanceValidationError('Only a contract or an expense has an amount');
    }
    // A project only on a contract of one client (Phase 33 P6, decision 23).
    if ((!contract || shared) && patch.projectId !== undefined) {
      throw new FinanceValidationError('Only a contract of one client has a project');
    }
    const projectId =
      patch.projectId !== undefined
        ? (await checkFinanceProject(tx, groupId, patch.projectId, null)).projectId
        : row.projectId;
    if (!shared && has(SHARED_KEYS)) {
      throw new FinanceValidationError('Only a contract of several clients has shares');
    }
    if (!expense && has(EXPENSE_KEYS)) {
      throw new FinanceValidationError('Only an expense has a date');
    }
    const title = patch.title ?? row.title;
    if (title === '') throw new FinanceValidationError('A title is needed');
    const startsOn = expense ? (patch.spentOn ?? row.startsOn) : (patch.startsOn ?? row.startsOn);
    const endsOn = expense ? startsOn : (patch.endsOn ?? row.endsOn);
    if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
      throw new FinanceValidationError('A contract cannot end before it starts');
    }
    const amountMinor = patch.amount?.amountMinor ?? row.amountMinor;
    if (shared && (patch.amount !== undefined || patch.shares !== undefined)) {
      // A new amount or new shares must add up again (O1; decision E21 after a client's delete).
      const shares =
        patch.shares ??
        (await tx
          .select({
            groupId: financeContractShares.groupId,
            amountMinor: financeContractShares.amountMinor,
          })
          .from(financeContractShares)
          .where(eq(financeContractShares.itemId, id)));
      await checkShares(tx, amountMinor!, shares);
      // ADR 0066: the master still covers the clients, and the contracts under it theirs.
      if (patch.shares) {
        await checkTreeAfterShares(
          tx,
          { id, parentId: patch.parentId !== undefined ? patch.parentId : row.parentId },
          patch.shares.map((s) => s.groupId),
        );
      }
      if (patch.shares) {
        await tx.delete(financeContractShares).where(eq(financeContractShares.itemId, id));
        await tx.insert(financeContractShares).values(
          patch.shares.map((s) => ({
            itemId: id,
            groupId: s.groupId,
            amountMinor: s.amountMinor,
          })),
        );
      }
    }
    const folderId =
      patch.folderId !== undefined
        ? await folderOfGroup(tx, groupId, patch.folderId)
        : row.folderId;

    // ADR 0066: the master (one level, covering the clients), the schedule and a document's link.
    const parentId = patch.parentId !== undefined ? patch.parentId : row.parentId;
    if (contract && patch.parentId !== undefined && patch.parentId !== null) {
      const clients = shared
        ? (patch.shares?.map((s) => s.groupId) ?? (await itemShareGroups(tx, id)))
        : [groupId!];
      await checkParent(tx, { id, clients }, patch.parentId);
    }
    const linkedBefore = row.type === 'document' ? await linkedContractId(tx, id) : null;
    const counterparts = await counterpartValues(tx, by, [
      patch.parentId !== undefined ? row.parentId : null,
      patch.parentId ?? null,
      patch.contractLink !== undefined ? linkedBefore : null,
      patch.contractLink?.contractId ?? null,
    ]);
    if (contract && patch.schedule !== undefined) {
      await writeSchedule(tx, id, patch.schedule, endsOn!);
    } else if (contract && patch.endsOn !== undefined) {
      await checkScheduleForEnd(tx, id, endsOn!);
    }
    if (row.type === 'document' && patch.contractLink !== undefined) {
      await writeContractLink(tx, { id, groupId }, patch.contractLink);
    }

    const current = (
      await tx
        .select({ fileId: financeAttachments.fileId })
        .from(financeAttachments)
        .where(eq(financeAttachments.itemId, id))
    ).map((r) => r.fileId);
    const next = patch.fileIds ? [...new Set(patch.fileIds)] : current;
    const added = next.filter((fileId) => !current.includes(fileId));
    const dropped = current.filter((fileId) => !next.includes(fileId));
    if (added.length > 0) {
      await attachFiles(tx, groupId, added, actorId, { finance: true });
      await tx.insert(financeAttachments).values(added.map((fileId) => ({ itemId: id, fileId })));
    }
    if (dropped.length > 0) {
      await tx
        .delete(financeAttachments)
        .where(and(eq(financeAttachments.itemId, id), inArray(financeAttachments.fileId, dropped)));
      await detachFiles(tx, dropped);
    }

    const body = patch.body ?? row.body;
    const contractNumber =
      patch.contractNumber !== undefined
        ? patch.contractNumber === ''
          ? null
          : patch.contractNumber
        : row.contractNumber;
    const payerName = patch.payerName ?? row.payerName;
    await tx
      .update(financeItems)
      .set({
        title,
        body,
        folderId,
        ...(contract
          ? {
              contractNumber,
              amountMinor,
              currency: patch.amount?.currency ?? row.currency,
              startsOn,
              endsOn,
              payerName,
              projectId,
              parentId,
            }
          : {}),
        ...(expense
          ? {
              amountMinor,
              currency: patch.amount?.currency ?? row.currency,
              startsOn,
              endsOn,
            }
          : {}),
        searchText: await searchTextOf(tx, {
          title,
          body,
          extra: [contractNumber, payerName],
          fileIds: next,
        }),
        updatedAt: sql`now()`,
      })
      .where(eq(financeItems.id, id));
    if (by) {
      const [after] = await tx.select().from(financeItems).where(eq(financeItems.id, id));
      if (after) await recordItem(tx, by, 'updated', after, auditBefore);
    }
    await recordCounterparts(tx, by, counterparts);
    return dropped;
  });
  // A failure here leaves detached files, which the daily unattached cleanup removes.
  await deleteDetachedFiles(deps, removed).catch(() => undefined);
  return getItem(db, id);
}

/**
 * Deletes an item; its files go after the commit, its attachments, shares and reminders cascade.
 * Returns its owner and the clients that had a share (their tabs refresh).
 */
export async function deleteItem(
  deps: { db: Db; storage: Storage },
  id: string,
  by?: AuditActor,
): Promise<{ groupId: string | null; shareGroupIds: string[] }> {
  const { db } = deps;
  const owner = await itemOwner(db, id);
  if (owner === null) throw new FinanceNotFoundError();
  const groupId = owner.groupId;
  const result = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const ids = (
      await tx
        .select({ fileId: financeAttachments.fileId })
        .from(financeAttachments)
        .where(eq(financeAttachments.itemId, id))
    ).map((r) => r.fileId);
    const shareGroupIds = await itemShareGroups(tx, id);
    const [row] = await tx.select().from(financeItems).where(eq(financeItems.id, id));
    if (!row) throw new FinanceNotFoundError();
    // ADR 0066: the master loses a contract, its contracts their master, its documents their
    // contract, a document's contract the document; each records its own change.
    const counterparts = await counterpartValues(tx, by, [
      row.parentId,
      ...(row.type === 'contract' ? await childIds(tx, id) : []),
      ...(row.type === 'contract' ? await linkedDocumentIds(tx, id) : []),
      row.type === 'document' ? await linkedContractId(tx, id) : null,
    ]);
    await recordItem(tx, by, 'deleted', row);
    const gone = await tx
      .delete(financeItems)
      .where(eq(financeItems.id, id))
      .returning({ id: financeItems.id });
    if (gone.length === 0) throw new FinanceNotFoundError();
    await recordCounterparts(tx, by, counterparts);
    await detachFiles(tx, ids);
    return { fileIds: ids, shareGroupIds };
  });
  await deleteDetachedFiles(deps, result.fileIds).catch(() => undefined);
  return { groupId, shareGroupIds: result.shareGroupIds };
}
