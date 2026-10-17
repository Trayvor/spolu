import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { CurrencySchema, ENABLED_CURRENCIES } from '../money.js';
import { FinanceClientsFilterSchema, MonthSchema } from './common.js';
import { FinanceItemSchema } from './documents.js';

/**
 * The system-wide page `/finance` and its rankings (Phase 32 part D, spec §6.2). Written by A1,
 * refined by D only. The overview and the work log reuse part C's DTOs with a multi-client scope.
 */

export const RANKING_PAGE_SIZE = 20;

/** `GET /api/finance/overview?clients=&from=&to=` and `/api/finance/work-log?clients=…`. */
export const SystemRangeQuerySchema = z
  .object({ clients: FinanceClientsFilterSchema, from: MonthSchema, to: MonthSchema })
  .refine((q) => q.from <= q.to, { message: 'from after to' });
export type SystemRangeQuery = z.output<typeof SystemRangeQuerySchema>;

export const ContractSorts = ['start', 'end', 'amount'] as const;

/** `GET /api/finance/contracts?clients=&sort=&q=&after=`. */
export const ContractsQuerySchema = z.object({
  clients: FinanceClientsFilterSchema,
  sort: z.enum(ContractSorts).default('start'),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value.length >= 2 ? value : undefined))
    .optional(),
  after: z.string().min(1).max(500).optional(),
});
export type ContractsQuery = z.output<typeof ContractsQuerySchema>;

/** A row of the global contracts table (or a search hit, which may be a document or a note). */
export const ContractRowSchema = FinanceItemSchema.extend({
  groupName: z.string(),
  hasLogo: z.boolean(),
  groupUpdatedAt: z.string(),
});
export type ContractRow = z.infer<typeof ContractRowSchema>;

export const ContractsPageSchema = z.object({
  items: z.array(ContractRowSchema),
  nextCursor: z.string().nullable(),
});
export type ContractsPage = z.infer<typeof ContractsPageSchema>;

/** `GET /api/finance/rankings/paid?year=&month=&currency=&clients=&after=`. */
export const PaidRankingQuerySchema = z.object({
  clients: FinanceClientsFilterSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  currency: CurrencySchema.default(ENABLED_CURRENCIES[0]!),
  after: z.string().min(1).max(200).optional(),
});
export type PaidRankingQuery = z.output<typeof PaidRankingQuerySchema>;

const RankedClient = {
  rank: z.number().int(),
  groupId: z.string(),
  groupName: z.string(),
  hasLogo: z.boolean(),
  groupUpdatedAt: z.string(),
};

export const PaidRankingRowSchema = z.object({ ...RankedClient, amountMinor: z.number().int() });
export type PaidRankingRow = z.infer<typeof PaidRankingRowSchema>;

/** One page of 20; `total` is the sum over every ranked client (for the share column). */
export const PaidRankingPageSchema = z.object({
  rows: z.array(PaidRankingRowSchema),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type PaidRankingPage = z.infer<typeof PaidRankingPageSchema>;

/** `GET /api/finance/rankings/hours?from=&to=&admin=&sort=hours|cost&clients=&after=`. */
export const HoursRankingQuerySchema = z
  .object({
    clients: FinanceClientsFilterSchema,
    from: MonthSchema,
    to: MonthSchema,
    admin: IdSchema.optional(),
    sort: z.enum(['hours', 'cost']).default('hours'),
    after: z.string().min(1).max(200).optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from after to' });
export type HoursRankingQuery = z.output<typeof HoursRankingQuerySchema>;

export const HoursRankingRowSchema = z.object({
  ...RankedClient,
  minutes: z.number().int(),
  cost: z.number().int().nullable(),
});
export type HoursRankingRow = z.infer<typeof HoursRankingRowSchema>;

export const HoursRankingPageSchema = z.object({
  rows: z.array(HoursRankingRowSchema),
  nextCursor: z.string().nullable(),
});
export type HoursRankingPage = z.infer<typeof HoursRankingPageSchema>;
