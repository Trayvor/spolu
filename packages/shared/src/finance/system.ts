import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { CurrencySchema, ENABLED_CURRENCIES } from '../money.js';
import { FinanceClientsFilterSchema, FinanceInternalFilterSchema, MonthSchema } from './common.js';
import { FinanceItemSchema } from './documents.js';

/**
 * The system-wide page `/finance` and its rankings (Phase 32 part D, spec §6.2). Written by A1,
 * refined by D only. The overview and the work log reuse part C's DTOs with a multi-client scope.
 */

export const RANKING_PAGE_SIZE = 20;

/**
 * The `clients=` (and `internal=`, Phase 34 part E) filter of `GET /api/finance/overview` and
 * `/api/finance/work-log`; the rest of their query is part C's `OverviewQuerySchema` /
 * `WorkLogQuerySchema` (all time when no months).
 */
export const SystemClientsQuerySchema = z.object({
  clients: FinanceClientsFilterSchema,
  internal: FinanceInternalFilterSchema,
});
export type SystemClientsQuery = z.output<typeof SystemClientsQuerySchema>;

/**
 * The page period's optional `from`/`to` months (follow-up of part D): both or neither (all
 * time), `from` not after `to`.
 */
const monthRangeOk = (q: { from?: string; to?: string }) =>
  (q.from === undefined) === (q.to === undefined) &&
  (q.from === undefined || q.to === undefined || q.from <= q.to);

/** The contracts table's page size. */
export const CONTRACTS_PAGE_SIZE = 30;

export const ContractSorts = ['start', 'end', 'amount'] as const;

/**
 * The ledger's type filter (Phase 32 E, decision E12): contracts (the default, as before part
 * E), expenses, documents, notes, or every kind.
 */
export const LedgerTypes = ['contract', 'expense', 'document', 'note', 'all'] as const;
export type LedgerType = (typeof LedgerTypes)[number];

/**
 * `GET /api/finance/contracts?clients=&sort=&q=&from=&to=&after=`. `from`/`to` (the page period)
 * keep the contracts whose period overlaps those months; a search ignores them (documents and
 * notes have no period).
 */
export const ContractsQuerySchema = z
  .object({
    clients: FinanceClientsFilterSchema,
    internal: FinanceInternalFilterSchema,
    from: MonthSchema.optional(),
    to: MonthSchema.optional(),
    /** Which kinds; the period filters contracts and expenses only (decision E16). */
    type: z.enum(LedgerTypes).default('contract'),
    sort: z.enum(ContractSorts).default('start'),
    /** Newest start, latest end, largest amount first (`desc`, default) or the other way. */
    dir: z.enum(['asc', 'desc']).default('desc'),
    q: z
      .string()
      .trim()
      .max(100)
      .transform((value) => (value.length >= 2 ? value : undefined))
      .optional(),
    after: z.string().min(1).max(500).optional(),
  })
  .refine(monthRangeOk, { message: 'from and to' });
export type ContractsQuery = z.output<typeof ContractsQuerySchema>;

/**
 * A row of the global contracts table (the ledger). Without `q` the kinds of `type`; with `q`
 * (from 2 characters) a search over every finance item of the chosen clients, so a hit may be a
 * document or a note. `groupId` null (Phase 32 E): an item of the organisation (`groupName` '')
 * or a contract of several clients (`contract.shared` names the payer and every share).
 */
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

/**
 * `GET /api/finance/rankings/paid?from=&to=&currency=&clients=&after=`: the page period's months
 * (none: all time, up to today). `year` (and `month`) is the older form of the same range.
 */
export const PaidRankingQuerySchema = z
  .object({
    clients: FinanceClientsFilterSchema,
    from: MonthSchema.optional(),
    to: MonthSchema.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    currency: CurrencySchema.default(ENABLED_CURRENCIES[0]!),
    after: z.string().min(1).max(200).optional(),
  })
  .refine(monthRangeOk, { message: 'from and to' })
  .refine((q) => q.month === undefined || q.year !== undefined, { message: 'month needs year' })
  .refine((q) => q.year === undefined || q.from === undefined, { message: 'year or months' });
export type PaidRankingQuery = z.output<typeof PaidRankingQuerySchema>;

/** `rank` is shared by equal values (1, 1, 3). */
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
  /** The first row's amount, the bars' full width. */
  max: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type PaidRankingPage = z.infer<typeof PaidRankingPageSchema>;

/**
 * `GET /api/finance/rankings/hours?from=&to=&admin=&sort=hours|cost&clients=&after=`; no months:
 * all time.
 */
export const HoursRankingQuerySchema = z
  .object({
    clients: FinanceClientsFilterSchema,
    from: MonthSchema.optional(),
    to: MonthSchema.optional(),
    admin: IdSchema.optional(),
    sort: z.enum(['hours', 'cost']).default('hours'),
    after: z.string().min(1).max(200).optional(),
  })
  .refine(monthRangeOk, { message: 'from and to' });
export type HoursRankingQuery = z.output<typeof HoursRankingQuerySchema>;

/**
 * A row of the hours ranking. `groupId` null: the time without a client (owner decision 24,
 * "Bez klienta"), ranked like a client on the all-clients view only; `groupName` is then ''.
 * `cost` (EUR minor units) is null when none of the minutes has a rate; the cost sort counts it 0.
 */
export const HoursRankingRowSchema = z.object({
  ...RankedClient,
  groupId: z.string().nullable(),
  minutes: z.number().int(),
  cost: z.number().int().nullable(),
  missingRateMinutes: z.number().int(),
});
export type HoursRankingRow = z.infer<typeof HoursRankingRowSchema>;

/** One page of 20; `max` is the first row's value (minutes or cost), the bars' full width. */
export const HoursRankingPageSchema = z.object({
  rows: z.array(HoursRankingRowSchema),
  max: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type HoursRankingPage = z.infer<typeof HoursRankingPageSchema>;
