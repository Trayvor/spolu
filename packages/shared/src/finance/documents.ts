import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { FileInfoSchema } from '../files.js';
import { MoneyInputSchema, MoneySchema } from '../money.js';
import { DaySchema } from './common.js';

/**
 * Documents and contracts (Phase 32 part B, spec §3.2 and §6.1): the Documents card of a
 * client's Finance tab. Written by A1, refined by B only. Reminders of an item go through the
 * reminders module (`/api/finance-items/:id/reminders`), not through these bodies.
 */

export const FinanceItemTypes = ['contract', 'document', 'note'] as const;
export const FinanceItemTypeSchema = z.enum(FinanceItemTypes);
export type FinanceItemType = z.infer<typeof FinanceItemTypeSchema>;

export const FINANCE_LIMITS = {
  /** Items per page of the card and of the global contracts table. */
  pageSize: 30,
  title: 200,
  body: 10_000,
  contractNumber: 60,
  folderName: 100,
  filesPerItem: 20,
  /** A contract ending within this many days is "Ending soon". */
  endingSoonDays: 60,
} as const;

export const FinanceFolderSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinanceFolder = z.infer<typeof FinanceFolderSchema>;
export const FinanceFolderListSchema = z.array(FinanceFolderSchema);

const FolderNameSchema = z.string().trim().min(1).max(FINANCE_LIMITS.folderName);

/** `POST /api/groups/:id/finance/folders`. */
export const FinanceFolderBodySchema = z
  .object({ name: FolderNameSchema, parentId: IdSchema.nullable().default(null) })
  .strict();
export type FinanceFolderBody = z.output<typeof FinanceFolderBodySchema>;

/** `PATCH /api/finance/folders/:id`: rename and/or move. */
export const FinanceFolderPatchSchema = z
  .object({ name: FolderNameSchema.optional(), parentId: IdSchema.nullable().optional() })
  .strict();
export type FinanceFolderPatch = z.infer<typeof FinanceFolderPatchSchema>;

/** A contract's own fields: number, amount (minor units + currency) and period. */
export const ContractFieldsSchema = z.object({
  contractNumber: z.string().nullable(),
  amount: MoneySchema,
  startsOn: DaySchema,
  endsOn: DaySchema,
});
export type ContractFields = z.infer<typeof ContractFieldsSchema>;

/** One row of the Documents card (and, with its client, of the global contracts table). */
export const FinanceItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  type: FinanceItemTypeSchema,
  folderId: z.string().nullable(),
  title: z.string(),
  /** Set for contracts only. */
  contract: ContractFieldsSchema.nullable(),
  fileCount: z.number().int(),
  /** The item has an unfired reminder time (the row's bell). */
  hasUpcomingReminder: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** A search result's folder path (names from the root); absent outside a search. */
  folderPath: z.array(z.string()).optional(),
});
export type FinanceItem = z.infer<typeof FinanceItemSchema>;

/** `GET /api/groups/:id/finance/items`: one page, keyset on `(created_at, id)` desc. */
export const FinanceItemPageSchema = z.object({
  items: z.array(FinanceItemSchema),
  nextCursor: z.string().nullable(),
});
export type FinanceItemPage = z.infer<typeof FinanceItemPageSchema>;

/** `GET /api/finance/items/:id`: an item with its body and files. */
export const FinanceItemDetailSchema = FinanceItemSchema.extend({
  body: z.string(),
  files: z.array(FileInfoSchema),
  createdByName: z.string(),
});
export type FinanceItemDetail = z.infer<typeof FinanceItemDetailSchema>;

/** The card's query: `folder` (an id, or omitted for the root), `type`, `q` (from 2 chars), `after`. */
export const FinanceItemsQuerySchema = z.object({
  folder: IdSchema.optional(),
  type: FinanceItemTypeSchema.optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value.length >= 2 ? value : undefined))
    .optional(),
  after: z.string().min(1).max(500).optional(),
});
export type FinanceItemsQuery = z.output<typeof FinanceItemsQuerySchema>;

const TitleSchema = z.string().trim().min(1).max(FINANCE_LIMITS.title);
const BodyTextSchema = z
  .string()
  .max(FINANCE_LIMITS.body)
  .refine((v) => !v.includes('\0'))
  .default('');
const FileIdsSchema = z.array(IdSchema).max(FINANCE_LIMITS.filesPerItem).default([]);
const ContractNumberSchema = z
  .string()
  .trim()
  .max(FINANCE_LIMITS.contractNumber)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .default(null);

const commonFields = {
  title: TitleSchema,
  body: BodyTextSchema,
  folderId: IdSchema.nullable().default(null),
  fileIds: FileIdsSchema,
};

const contractBody = z
  .object({
    type: z.literal('contract'),
    ...commonFields,
    contractNumber: ContractNumberSchema,
    amount: MoneyInputSchema,
    startsOn: DaySchema,
    endsOn: DaySchema,
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { message: 'ends before it starts', path: ['endsOn'] });

/** `POST /api/groups/:id/finance/items`: a contract needs its amount and period. */
export const FinanceItemBodySchema = z.union([
  contractBody,
  z.object({ type: z.literal('document'), ...commonFields }).strict(),
  z.object({ type: z.literal('note'), ...commonFields }).strict(),
]);
export type FinanceItemBody = z.output<typeof FinanceItemBodySchema>;

/**
 * `PATCH /api/finance/items/:id`: the fields that change, plus the `updatedAt` the editor
 * loaded (`409 finance_changed` when it moved on). The type never changes; contract fields
 * are accepted only on a contract (the service checks).
 */
export const FinanceItemPatchSchema = z
  .object({
    updatedAt: z.string(),
    title: TitleSchema.optional(),
    body: z.string().max(FINANCE_LIMITS.body).optional(),
    folderId: IdSchema.nullable().optional(),
    fileIds: z.array(IdSchema).max(FINANCE_LIMITS.filesPerItem).optional(),
    contractNumber: z.string().trim().max(FINANCE_LIMITS.contractNumber).nullable().optional(),
    amount: MoneyInputSchema.optional(),
    startsOn: DaySchema.optional(),
    endsOn: DaySchema.optional(),
  })
  .strict();
export type FinanceItemPatch = z.infer<typeof FinanceItemPatchSchema>;
