import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { FileInfoSchema } from '../files.js';
import { MoneyInputSchema, MoneySchema } from '../money.js';
import { MonthSchema } from './common.js';

/**
 * Salaries ("Mzdy", owner request of 2026-10-21, ADR 0065): what the organisation paid one admin
 * for one month, a record of its own beside the expenses ("Výdavky", which no longer have a
 * salary kind). Only finance admins see or change them (an admin without the right gets 404,
 * even for their own salary). Money is integer minor units (`amountMinor`) plus a currency.
 */

export const SALARY_LIMITS = {
  /** The note (the old salary expense's title and description fit, migration 0069). */
  note: 10_500,
  filesPerSalary: 20,
  documentsPerItem: 50,
  pageSize: 50,
} as const;

/** A finance document linked to a salary or an expense (`finance_cost_documents`). */
export const LinkedDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Null: a document of the organisation. */
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
});
export type LinkedDocument = z.infer<typeof LinkedDocumentSchema>;

/** What a document is linked to: salaries and expenses (shown on the document's sheet). */
export const LinkedCostSchema = z.object({
  kind: z.enum(['salary', 'expense']),
  id: z.string(),
  /** An expense's title; a salary's admin and month ("Eva Nováková · 2026-09"). */
  label: z.string(),
});
export type LinkedCost = z.infer<typeof LinkedCostSchema>;

/** One row of the Mzdy list. */
export const SalarySchema = z.object({
  id: z.string(),
  payeeId: z.string(),
  payeeName: z.string(),
  month: MonthSchema,
  amount: MoneySchema,
  note: z.string(),
  fileCount: z.number().int(),
  documentCount: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Salary = z.infer<typeof SalarySchema>;

/** `GET /api/finance/salaries/:id`: a salary with its files and linked documents. */
export const SalaryDetailSchema = SalarySchema.extend({
  files: z.array(FileInfoSchema),
  documents: z.array(LinkedDocumentSchema),
  createdByName: z.string(),
});
export type SalaryDetail = z.infer<typeof SalaryDetailSchema>;

/** The totals of the filtered salaries, per currency (EUR first). */
export const SalaryTotalsSchema = z.object({
  total: z.array(MoneySchema.extend({ count: z.number().int() })),
  byAdmin: z.array(
    z.object({
      payeeId: z.string(),
      payeeName: z.string(),
      amount: MoneySchema,
      count: z.number().int(),
    }),
  ),
  byMonth: z.array(z.object({ month: MonthSchema, amount: MoneySchema })),
});
export type SalaryTotals = z.infer<typeof SalaryTotalsSchema>;

/** `GET /api/finance/salaries`: newest month first; `totals` on the first page only. */
export const SalaryPageSchema = z.object({
  items: z.array(SalarySchema),
  nextCursor: z.string().nullable(),
  totals: SalaryTotalsSchema.nullable(),
});
export type SalaryPage = z.infer<typeof SalaryPageSchema>;

/** `?admin=&from=&to=&after=`: one admin (absent: all), an inclusive month range (absent: all). */
export const SalariesQuerySchema = z
  .object({
    admin: IdSchema.optional(),
    from: MonthSchema.optional(),
    to: MonthSchema.optional(),
    after: z.string().min(1).max(200).optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'from with to' })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from after to' });
export type SalariesQuery = z.infer<typeof SalariesQuerySchema>;

const NoteSchema = z
  .string()
  .max(SALARY_LIMITS.note)
  .refine((v) => !v.includes('\0'));

/** `POST /api/finance/salaries`. */
export const SalaryBodySchema = z
  .object({
    payeeId: IdSchema,
    month: MonthSchema,
    amount: MoneyInputSchema,
    note: NoteSchema.default(''),
    fileIds: z.array(IdSchema).max(SALARY_LIMITS.filesPerSalary).default([]),
  })
  .strict();
export type SalaryBody = z.output<typeof SalaryBodySchema>;

/** `PATCH /api/finance/salaries/:id`: the fields that change and the `updatedAt` loaded (409). */
export const SalaryPatchSchema = z
  .object({
    updatedAt: z.string(),
    payeeId: IdSchema.optional(),
    month: MonthSchema.optional(),
    amount: MoneyInputSchema.optional(),
    note: NoteSchema.optional(),
    fileIds: z.array(IdSchema).max(SALARY_LIMITS.filesPerSalary).optional(),
  })
  .strict();
export type SalaryPatch = z.infer<typeof SalaryPatchSchema>;

/** `POST /api/finance/salaries/:id/documents` and `/api/finance/expenses/:id/documents`. */
export const LinkDocumentBodySchema = z.object({ documentId: IdSchema }).strict();
export type LinkDocumentBody = z.infer<typeof LinkDocumentBodySchema>;
