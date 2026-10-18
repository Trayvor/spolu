import { z } from 'zod';
import { FinanceItemTypes } from '@spolu/shared';
import { cursorArg, defineTool, fromApi, idArg, query, type ToolDef } from './define.js';

/**
 * Finance through MCP is documents only (spec §2 #5–6): the items and folders of a client's
 * Documents card, read only, for finance holders. Every answer is a projection that copies the
 * named fields and nothing else, so a contract's amount, and any field a later change adds to the
 * finance DTOs, never reaches the AI. The work log, time, rates, overviews, the contracts table,
 * the rankings and expenses have no tool and no allowlist entry.
 */

type Obj = Record<string, unknown>;
const asObj = (value: unknown): Obj =>
  value !== null && typeof value === 'object' ? (value as Obj) : {};
const pickFields = (source: unknown, keys: readonly string[]): Obj => {
  const from = asObj(source);
  const out: Obj = {};
  for (const key of keys) if (key in from) out[key] = from[key];
  return out;
};

const ITEM_FIELDS = [
  'id',
  'groupId',
  'type',
  'folderId',
  'title',
  'fileCount',
  'hasUpcomingReminder',
  'createdBy',
  'createdAt',
  'updatedAt',
  'folderPath',
] as const;
/** A contract's document data: never `amount`. */
const CONTRACT_FIELDS = ['contractNumber', 'startsOn', 'endsOn'] as const;
const FILE_FIELDS = ['id', 'name', 'mime', 'size'] as const;
const FOLDER_FIELDS = ['id', 'groupId', 'parentId', 'name', 'createdAt', 'updatedAt'] as const;

export function projectFinanceItem(item: unknown): Obj {
  const contract = asObj(item).contract;
  return {
    ...pickFields(item, ITEM_FIELDS),
    contract: contract ? pickFields(contract, CONTRACT_FIELDS) : null,
  };
}

export function projectFinanceDetail(item: unknown): Obj {
  const files = asObj(item).files;
  return {
    ...projectFinanceItem(item),
    ...pickFields(item, ['body', 'createdByName']),
    files: Array.isArray(files) ? files.map((file) => pickFields(file, FILE_FIELDS)) : [],
  };
}

export function projectFinancePage(page: unknown): Obj {
  const items = asObj(page).items;
  return {
    items: Array.isArray(items) ? items.map(projectFinanceItem) : [],
    nextCursor: asObj(page).nextCursor ?? null,
  };
}

export function projectFinanceFolders(list: unknown): Obj[] {
  return Array.isArray(list) ? list.map((folder) => pickFields(folder, FOLDER_FIELDS)) : [];
}

export const financeTools: ToolDef[] = [
  defineTool({
    name: 'list_finance_documents',
    title: 'List finance documents',
    description:
      'A client’s finance documents (finance admins only): contracts (number, title and period; amounts are never given), documents and notes, newest first, 30 a page. Without `type` and `q` the open `folder` (a folder id, default the top level); a `type` ("contract", "document", "note") or a search `q` lists every folder. Paged with `after` from `nextCursor`.',
    input: z.object({
      groupId: idArg('group'),
      folder: z.string().max(64).optional(),
      type: z.enum(FinanceItemTypes).optional(),
      q: z.string().max(100).optional(),
      after: cursorArg,
    }),
    finance: true,
    run: async ({ api }, { groupId, ...rest }) =>
      fromApi(
        await api('GET', `/api/groups/${groupId}/finance/items`, { query: query(rest) }),
        projectFinancePage,
      ),
  }),
  defineTool({
    name: 'list_finance_folders',
    title: 'List finance folders',
    description: 'The folders of a client’s finance documents (finance admins only).',
    input: z.object({ groupId: idArg('group') }),
    finance: true,
    run: async ({ api }, { groupId }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/finance/folders`), projectFinanceFolders),
  }),
  defineTool({
    name: 'get_finance_document',
    title: 'Get a finance document',
    description:
      'One finance document, contract or note (finance admins only): its text and files (read_file gives a file’s content); a contract’s number and period, never its amount.',
    input: z.object({ itemId: idArg('finance item') }),
    finance: true,
    run: async ({ api }, { itemId }) =>
      fromApi(await api('GET', `/api/finance/items/${itemId}`), projectFinanceDetail),
  }),
];
