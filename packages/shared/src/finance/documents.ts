import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { FileInfoSchema } from '../files.js';
import { MoneyInputSchema, MoneySchema } from '../money.js';
import { ProjectRefSchema } from '../projects/common.js';
import { DaySchema } from './common.js';
import {
  ContractLinkInputSchema,
  ContractLinkSchema,
  ContractPaymentsSchema,
  ContractRefSchema,
  ContractDocumentSchema,
  ContractScheduleSchema,
  ScheduleInputSchema,
} from './contracts.js';
import { FinanceProjectIdSchema } from './projects.js';
import { LinkedCostSchema, LinkedDocumentSchema } from './salaries.js';

/**
 * Documents and contracts (Phase 32 part B, spec §3.2 and §6.1): the Documents card of a
 * client's Finance tab. Written by A1, refined by B only. Reminders of an item go through the
 * reminders module (`/api/finance-items/:id/reminders`), not through these bodies.
 */

/**
 * Every kind of finance item. `expense` (Phase 32 E) exists only at organisation level (no
 * client); a client's tab creates and filters only `CLIENT_ITEM_TYPES`.
 */
export const FinanceItemTypes = ['contract', 'document', 'note', 'expense'] as const;
export const FinanceItemTypeSchema = z.enum(FinanceItemTypes);
export type FinanceItemType = z.infer<typeof FinanceItemTypeSchema>;

/** The kinds a client's Documents card creates and filters (never an expense). */
export const CLIENT_ITEM_TYPES = ['contract', 'document', 'note'] as const;
export type ClientItemType = (typeof CLIENT_ITEM_TYPES)[number];

/**
 * An expense (Phase 32 E): any payment of the organisation. Admins' salaries are their own
 * records since 2026-10-21 (`salaries.ts`, ADR 0065), so `other` is the only kind left.
 */
export const ExpenseKinds = ['other'] as const;
export const ExpenseKindSchema = z.enum(ExpenseKinds);
export type ExpenseKind = z.infer<typeof ExpenseKindSchema>;

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
  /** A contract of several clients (Phase 32 E): the payer's name, and 2–50 client shares. */
  payerName: 200,
  minShares: 2,
  maxShares: 50,
} as const;

export const FinanceFolderSchema = z.object({
  id: z.string(),
  /** Null: a folder of the organisation (Phase 32 E). */
  groupId: z.string().nullable(),
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

/** One client's part of a contract of several clients (Phase 32 E), in the contract's currency. */
export const ContractShareSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  amountMinor: z.number().int(),
});
export type ContractShare = z.infer<typeof ContractShareSchema>;

/**
 * A contract of several clients (Phase 32 E, decisions O1, E7, E10): one payer ("Nadradená
 * organizácia") pays `total` for several clients, each with its share. In a client's tab
 * `shares` holds that client's share only (never the other clients' names or shares).
 */
export const SharedContractSchema = z.object({
  payerName: z.string(),
  total: MoneySchema,
  shares: z.array(ContractShareSchema),
});
export type SharedContract = z.infer<typeof SharedContractSchema>;

/**
 * A contract's own fields: number, amount (minor units + currency) and period. `amount` is what
 * the view counts: the whole amount, or in a client's tab that client's share of a contract of
 * several clients (`shared.total` is then the whole amount).
 */
export const ContractFieldsSchema = z.object({
  contractNumber: z.string().nullable(),
  amount: MoneySchema,
  startsOn: DaySchema,
  endsOn: DaySchema,
  /** Set for a contract of several clients only. */
  shared: SharedContractSchema.nullable(),
  /**
   * The client's project the contract is for (Phase 33 P6, decision 23; a contract of one client
   * only, never an event). Null when none, or when that project was deleted since.
   */
  project: ProjectRefSchema.nullable().optional(),
  /** The stored project id (kept after the project is deleted, decision 25). */
  projectId: z.string().nullable().optional(),
  /** Its master contract ("Rámcová zmluva", ADR 0066), or null. */
  parentId: z.string().nullable().optional(),
  /** It has a payment schedule (the detail carries it). */
  hasSchedule: z.boolean().optional(),
});
export type ContractFields = z.infer<typeof ContractFieldsSchema>;

/** An expense's own fields (Phase 32 E): kind, amount and date. */
export const ExpenseFieldsSchema = z.object({
  kind: ExpenseKindSchema,
  amount: MoneySchema,
  spentOn: DaySchema,
});
export type ExpenseFields = z.infer<typeof ExpenseFieldsSchema>;

/** One row of the Documents card (and, with its client, of the global contracts table). */
export const FinanceItemSchema = z.object({
  id: z.string(),
  /** Null: an item of the organisation (Phase 32 E), shown on `/finance` only. */
  groupId: z.string().nullable(),
  type: FinanceItemTypeSchema,
  folderId: z.string().nullable(),
  title: z.string(),
  /** Set for contracts only. */
  contract: ContractFieldsSchema.nullable(),
  /** Set for expenses only. */
  expense: ExpenseFieldsSchema.nullable(),
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
  /** An expense: the finance documents linked to it (2026-10-21). */
  costDocuments: z.array(LinkedDocumentSchema).optional(),
  /** A document: the salaries and expenses it is linked to (2026-10-21). */
  linkedCosts: z.array(LinkedCostSchema).optional(),
  /**
   * A contract (ADR 0066): its master and the contracts under it (those the view may show), its
   * schedule with the expected payments against the payments of its linked documents, and those
   * documents. Absent on other types.
   */
  parent: ContractRefSchema.nullable().optional(),
  children: z.array(ContractRefSchema).optional(),
  schedule: ContractScheduleSchema.nullable().optional(),
  payments: ContractPaymentsSchema.nullable().optional(),
  documents: z.array(ContractDocumentSchema).optional(),
  /** A document: the contract it is linked to, and the payment it records. */
  contractLink: ContractLinkSchema.nullable().optional(),
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
    /** Phase 33 P6: one of the client's projects (optional). */
    projectId: FinanceProjectIdSchema.nullable().default(null),
    /** ADR 0066: its master contract (one level only; the service checks the rules). */
    parentId: IdSchema.nullable().default(null),
    /** ADR 0066: the payment schedule, or null for none. */
    schedule: ScheduleInputSchema.nullable().default(null),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { message: 'ends before it starts', path: ['endsOn'] });

const documentBody = z
  .object({
    type: z.literal('document'),
    ...commonFields,
    /** ADR 0066: the contract it belongs to, and the payment it records. */
    contractLink: ContractLinkInputSchema.nullable().default(null),
  })
  .strict();
const noteBody = z.object({ type: z.literal('note'), ...commonFields }).strict();

/** `POST /api/groups/:id/finance/items`: a contract needs its amount and period. */
export const FinanceItemBodySchema = z.union([contractBody, documentBody, noteBody]);
export type FinanceItemBody = z.output<typeof FinanceItemBodySchema>;

/** Why a list of shares is refused (Phase 32 E, decisions O1, E8). */
export type ShareProblem = 'tooFew' | 'tooMany' | 'duplicate' | 'negative' | 'sum';

/**
 * The shares of a contract of several clients: 2–50 clients, each once, no share below 0 (a
 * share of 0 is allowed since an amount may be 0, owner request of 2026-10-21),
 * adding up exactly to the amount (integer minor units, so no rounding). The currency is the
 * contract's: a share has none of its own. Null when they are valid.
 */
export function shareProblem(
  totalMinor: number,
  shares: readonly { groupId: string; amountMinor: number }[],
): ShareProblem | null {
  if (shares.length < FINANCE_LIMITS.minShares) return 'tooFew';
  if (shares.length > FINANCE_LIMITS.maxShares) return 'tooMany';
  if (new Set(shares.map((s) => s.groupId)).size !== shares.length) return 'duplicate';
  if (shares.some((s) => !Number.isSafeInteger(s.amountMinor) || s.amountMinor < 0)) {
    return 'negative';
  }
  const sum = shares.reduce((acc, s) => acc + BigInt(s.amountMinor), 0n);
  return sum === BigInt(totalMinor) ? null : 'sum';
}

/** One share as a form sends it. */
export const ShareInputSchema = z
  .object({
    groupId: IdSchema,
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ShareInput = z.infer<typeof ShareInputSchema>;

const PayerNameSchema = z.string().trim().min(1).max(FINANCE_LIMITS.payerName);
const SharesSchema = z.array(ShareInputSchema).max(FINANCE_LIMITS.maxShares);

/** A contract of several clients: the contract's fields, the payer and the shares (O1). */
const sharedContractBody = z
  .object({
    type: z.literal('contract'),
    ...commonFields,
    contractNumber: ContractNumberSchema,
    amount: MoneyInputSchema,
    startsOn: DaySchema,
    endsOn: DaySchema,
    payerName: PayerNameSchema,
    shares: SharesSchema,
    /** ADR 0066: a master of several clients that covers all of these clients, and a schedule. */
    parentId: IdSchema.nullable().default(null),
    schedule: ScheduleInputSchema.nullable().default(null),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { message: 'ends before it starts', path: ['endsOn'] })
  .refine((v) => shareProblem(v.amount.amountMinor, v.shares) === null, {
    message: 'shares',
    path: ['shares'],
  });

/**
 * An expense (Phase 32 E): its title says what it is for. No salary: an admin's salary is a
 * salary record (`SalaryBodySchema`, 2026-10-21), so `expenseKind` is `other` or left out.
 */
const expenseBody = z
  .object({
    type: z.literal('expense'),
    ...commonFields,
    expenseKind: ExpenseKindSchema.default('other'),
    amount: MoneyInputSchema,
    spentOn: DaySchema,
  })
  .strict();

/**
 * `POST /api/finance/org/items` (Phase 32 E): an item of the organisation, made on `/finance`: a
 * contract of several clients, an expense, a document or a note without a client. A contract of
 * one client is made with `POST /api/groups/:id/finance/items`.
 */
export const FinanceOrgItemBodySchema = z.union([
  sharedContractBody,
  expenseBody,
  documentBody,
  noteBody,
]);
export type FinanceOrgItemBody = z.output<typeof FinanceOrgItemBodySchema>;

/** `GET /api/finance/items/:id?group=`: a client's view of the item (its own share only). */
export const FinanceItemViewQuerySchema = z.object({ group: IdSchema.optional() });

/** The reminder a new expense's form proposes: this many days before its date, at 09:00. */
export const EXPENSE_REMINDER_DAYS_BEFORE = 1;

/**
 * `PATCH /api/finance/items/:id`: the fields that change, plus the `updatedAt` the editor
 * loaded (`409 finance_changed` when it moved on). The type never changes; contract fields
 * are accepted only on a contract, the payer and the shares only on a contract of several
 * clients, the expense fields only on an expense (the service checks, and checks the shares
 * against the resulting amount).
 */
export const FinanceItemPatchSchema = z
  .object({
    updatedAt: z.string(),
    title: z.string().trim().min(1).max(FINANCE_LIMITS.title).optional(),
    body: z.string().max(FINANCE_LIMITS.body).optional(),
    folderId: IdSchema.nullable().optional(),
    fileIds: z.array(IdSchema).max(FINANCE_LIMITS.filesPerItem).optional(),
    contractNumber: z.string().trim().max(FINANCE_LIMITS.contractNumber).nullable().optional(),
    amount: MoneyInputSchema.optional(),
    startsOn: DaySchema.optional(),
    endsOn: DaySchema.optional(),
    /** A contract of several clients (Phase 32 E): the payer, and every share (replaced whole). */
    payerName: PayerNameSchema.optional(),
    shares: SharesSchema.optional(),
    /** A contract of one client (Phase 33 P6): its project, or null for none. */
    projectId: FinanceProjectIdSchema.nullable().optional(),
    /** An expense: its date. The kind never changes. */
    spentOn: DaySchema.optional(),
    /** A contract (ADR 0066): its master, or null for none; its schedule, or null for none. */
    parentId: IdSchema.nullable().optional(),
    schedule: ScheduleInputSchema.nullable().optional(),
    /** A document (ADR 0066): its contract and payment, or null to unlink. */
    contractLink: ContractLinkInputSchema.nullable().optional(),
  })
  .strict();
export type FinanceItemPatch = z.infer<typeof FinanceItemPatchSchema>;

/** A finance admin a finance reminder may notify (`GET /api/finance/recipients`). */
export const FinancePersonSchema = z.object({ id: z.string(), name: z.string() });
export type FinancePerson = z.infer<typeof FinancePersonSchema>;
export const FinancePeopleSchema = z.array(FinancePersonSchema);

/** The reminder a new contract's form proposes: this many days before its end, at 09:00. */
export const CONTRACT_REMINDER_DAYS_BEFORE = 30;
