import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  FINANCE_LIMITS,
  type ContractsPage,
  type Currency,
  type FileInfo,
  type FinanceItem,
  type FinanceItemBody,
  type FinanceItemDetail,
  type FinanceItemPage,
  type FinanceItemPatch,
  type FinanceItemType,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { buildSearchText, escapeLike, searchTerms } from '../../infra/text/search.js';
import { files } from '../files/schema.js';
import { attachFiles, deleteDetachedFiles, detachFiles, toFileInfo } from '../files/service.js';
import { getUserNames } from '../users/service.js';
import { FinanceChangedError, FinanceNotFoundError, FinanceValidationError } from './errors.js';
import { folderOfGroup, folderPaths, lockGroupFinance } from './folders.js';
import { financeAttachments, financeItems } from './schema.js';
import { scopeSql, type FinanceScope } from './scope.js';

/**
 * Finance items (Phase 32 part B, spec §3.2, §6.1): one client's contracts, documents and notes.
 * Only finance admins reach these functions (the finance plugin's `requireFinance`); nothing here
 * checks the actor again. D's global contracts table and the finance search call `listItems` (or
 * `listContracts`, the same rows with their client) with a `groups` or `all` scope.
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
};

type PageRow = {
  id: string;
  group_id: string;
  type: FinanceItemType;
  folder_id: string | null;
  title: string;
  contract_number: string | null;
  amount_minor: string | null;
  currency: Currency | null;
  starts_on: string | null;
  ends_on: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  created_text: string;
  file_count: number;
  has_reminder: boolean;
  group_name: string;
  has_logo: boolean;
  group_updated: string;
};

/** `finance_items` as `i`, the alias of the page query (the scope's condition names it). */
const i = alias(financeItems, 'i');

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
    // Contracts always have the value (CHECKs), so their order needs no `nulls last`, and
    // without it `starts_on desc` reads `finance_items_contract_starts_idx` backwards (part D).
    orderBy:
      filter.type === 'contract'
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

function filterWhere(scope: FinanceScope, filter: ListItemsFilter): SQL {
  const parts: SQL[] = [scopeSql(i.groupId, scope)];
  if (filter.type) parts.push(sql`i.type = ${filter.type}`);
  for (const term of searchTerms(filter.q ?? '')) {
    parts.push(sql`i.search_text ilike '%' || ${escapeLike(term)} || '%' escape '\\'`);
  }
  if (filter.folderId === null) parts.push(sql`i.folder_id is null`);
  else if (filter.folderId !== undefined) parts.push(sql`i.folder_id = ${filter.folderId}`);
  return sql.join(parts, sql` and `);
}

/**
 * The single query of a page and of the detail: items with their client, file count and whether a
 * reminder time is still to come. Primary-key joins and one index lookup per row (the attachments'
 * primary key, the reminder set's unique key).
 */
function pageQuery(where: SQL, orderBy: SQL, limit: number): SQL {
  return sql`
    select i.id, i.group_id, i.type, i.folder_id, i.title, i.contract_number,
           i.amount_minor::text as amount_minor, i.currency,
           i.starts_on::text as starts_on, i.ends_on::text as ends_on, i.created_by,
           ${iso(sql`i.created_at`)} as created_at, ${iso(sql`i.updated_at`)} as updated_at,
           i.created_at::text as created_text,
           (select count(*)::int from finance_attachments a where a.item_id = i.id) as file_count,
           exists (select 1 from reminder_sets s join reminder_times t on t.set_id = s.id
                   where s.finance_item_id = i.id and t.fired_at is null) as has_reminder,
           g.name as group_name, g.logo_key is not null as has_logo,
           ${iso(sql`g.updated_at`)} as group_updated
    from finance_items i
    join groups g on g.id = i.group_id
    where ${where}
    order by ${orderBy}
    limit ${limit}`;
}

function toItem(row: PageRow): FinanceItem {
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
            amount: { amountMinor: Number(row.amount_minor), currency: row.currency! },
            startsOn: row.starts_on!,
            endsOn: row.ends_on!,
          }
        : null,
    fileCount: row.file_count,
    hasUpcomingReminder: row.has_reminder,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The first page's query of `listItems` / `listContracts` (part D's EXPLAIN checks). */
export function contractsPageSql(scope: FinanceScope, filter: ListItemsFilter): SQL {
  const size = Math.max(1, Math.min(filter.limit ?? FINANCE_LIMITS.pageSize, 100));
  return pageQuery(filterWhere(scope, filter), ordering(filter).orderBy, size + 1);
}

async function runPage(db: Db, scope: FinanceScope, filter: ListItemsFilter) {
  const size = Math.max(1, Math.min(filter.limit ?? FINANCE_LIMITS.pageSize, 100));
  const order = ordering(filter);
  const where = filterWhere(scope, filter);
  const full = filter.after ? sql`${where} and ${order.after(filter.after)}` : where;
  const rows = [...(await db.execute<PageRow>(pageQuery(full, order.orderBy, size + 1)))];
  const page = rows.slice(0, size);
  // A flat list (a search, a type filter, another scope) names each item's folder.
  const pathOf =
    filter.folderId === undefined
      ? await folderPaths(
          db,
          page.flatMap((row) => (row.folder_id ? [row.folder_id] : [])),
        )
      : null;
  const items = page.map((row) => {
    const item = toItem(row);
    if (pathOf) item.folderPath = row.folder_id ? pathOf(row.folder_id) : [];
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

/** `listItems` with each item's client (part D's global contracts table). */
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
      groupName: row.group_name,
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

/** One item with its body, files and author's name. */
export async function getItem(db: Db, id: string): Promise<FinanceItemDetail> {
  const [row] = [...(await db.execute<PageRow>(pageQuery(sql`i.id = ${id}`, sql`i.id`, 1)))];
  if (!row) throw new FinanceNotFoundError();
  const [[body], itemFileList, names] = await Promise.all([
    db.select({ body: financeItems.body }).from(financeItems).where(eq(financeItems.id, id)),
    itemFiles(db, id),
    getUserNames(db, [row.created_by]),
  ]);
  return {
    ...toItem(row),
    body: body?.body ?? '',
    files: itemFileList,
    createdByName: names.get(row.created_by) ?? '',
  };
}

/** The item's client, or null for an unknown id. */
export async function itemGroupId(db: Db, id: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: financeItems.groupId })
    .from(financeItems)
    .where(eq(financeItems.id, id));
  return row?.groupId ?? null;
}

async function searchTextOf(
  tx: Db,
  input: { title: string; body: string; contractNumber: string | null; fileIds: string[] },
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
    extra: input.contractNumber ? [input.contractNumber] : [],
  });
}

function checkBody(body: string): void {
  if (body.includes('\0')) throw new FinanceValidationError('A body cannot hold a NUL character');
}

/** Creates an item with its finance-only files, in one transaction. */
export async function createItem(
  db: Db,
  actorId: string,
  groupId: string,
  body: FinanceItemBody,
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
          }
        : {}),
      searchText: await searchTextOf(tx, {
        title: body.title,
        body: body.body,
        contractNumber,
        fileIds,
      }),
      createdBy: actorId,
    });
    if (fileIds.length > 0) {
      await tx.insert(financeAttachments).values(fileIds.map((fileId) => ({ itemId: id, fileId })));
    }
  });
  return getItem(db, id);
}

const CONTRACT_KEYS = ['contractNumber', 'amount', 'startsOn', 'endsOn'] as const;

/**
 * Edits an item in one transaction: the `updatedAt` check (`FinanceChangedError`), contract
 * fields only on a contract, the period kept in order, files attached and detached (the removed
 * ones are deleted after the commit), `search_text` rewritten. Returns the item and its client.
 */
export async function updateItem(
  deps: { db: Db; storage: Storage },
  actorId: string,
  id: string,
  patch: FinanceItemPatch,
): Promise<FinanceItemDetail> {
  const { db } = deps;
  const groupId = await itemGroupId(db, id);
  if (groupId === null) throw new FinanceNotFoundError();
  if (patch.body !== undefined) checkBody(patch.body);
  const removed = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const [row] = await tx.select().from(financeItems).where(eq(financeItems.id, id)).for('update');
    if (!row) throw new FinanceNotFoundError();
    if (row.updatedAt.getTime() !== Date.parse(patch.updatedAt)) throw new FinanceChangedError();
    if (row.type !== 'contract' && CONTRACT_KEYS.some((key) => patch[key] !== undefined)) {
      throw new FinanceValidationError('Only a contract has contract fields');
    }
    const startsOn = patch.startsOn ?? row.startsOn;
    const endsOn = patch.endsOn ?? row.endsOn;
    if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
      throw new FinanceValidationError('A contract cannot end before it starts');
    }
    const folderId =
      patch.folderId !== undefined
        ? await folderOfGroup(tx, groupId, patch.folderId)
        : row.folderId;

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

    const title = patch.title ?? row.title;
    const body = patch.body ?? row.body;
    const contractNumber =
      patch.contractNumber !== undefined
        ? patch.contractNumber === ''
          ? null
          : patch.contractNumber
        : row.contractNumber;
    await tx
      .update(financeItems)
      .set({
        title,
        body,
        folderId,
        ...(row.type === 'contract'
          ? {
              contractNumber,
              amountMinor: patch.amount?.amountMinor ?? row.amountMinor,
              currency: patch.amount?.currency ?? row.currency,
              startsOn,
              endsOn,
            }
          : {}),
        searchText: await searchTextOf(tx, { title, body, contractNumber, fileIds: next }),
        updatedAt: sql`now()`,
      })
      .where(eq(financeItems.id, id));
    return dropped;
  });
  // A failure here leaves detached files, which the daily unattached cleanup removes.
  await deleteDetachedFiles(deps, removed).catch(() => undefined);
  return getItem(db, id);
}

/** Deletes an item; its files go after the commit, its attachments and reminders cascade. */
export async function deleteItem(
  deps: { db: Db; storage: Storage },
  id: string,
): Promise<{ groupId: string }> {
  const { db } = deps;
  const groupId = await itemGroupId(db, id);
  if (groupId === null) throw new FinanceNotFoundError();
  const fileIds = await db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const ids = (
      await tx
        .select({ fileId: financeAttachments.fileId })
        .from(financeAttachments)
        .where(eq(financeAttachments.itemId, id))
    ).map((r) => r.fileId);
    const gone = await tx
      .delete(financeItems)
      .where(eq(financeItems.id, id))
      .returning({ id: financeItems.id });
    if (gone.length === 0) throw new FinanceNotFoundError();
    await detachFiles(tx, ids);
    return ids;
  });
  await deleteDetachedFiles(deps, fileIds).catch(() => undefined);
  return { groupId };
}
