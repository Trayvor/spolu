import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { CurrencySchema, MoneyInputSchema, MoneySchema } from '../money.js';
import { DaySchema, MonthSchema } from './common.js';

/**
 * Contracts v2 (owner request of 2026-10-21, ADR 0066): a master contract ("Rámcová zmluva",
 * one level only), a payment schedule with its expected payments, and finance documents linked
 * to a contract, each optionally recording a payment received for it. The schedule maths is
 * here, pure, so the server and the tests share it.
 */

/**
 * How often a contract expects a payment. `none` is no schedule at all (`schedule: null`);
 * `everyMonths` is "every N months", `dates` a custom list of days.
 */
export const ScheduleFrequencies = [
  'monthly',
  'quarterly',
  'semiannual',
  'yearly',
  'everyMonths',
  'dates',
] as const;
export const ScheduleFrequencySchema = z.enum(ScheduleFrequencies);
export type ScheduleFrequency = z.infer<typeof ScheduleFrequencySchema>;

/** Months between two payments of each fixed frequency. */
export const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 } as const;

export const SCHEDULE_LIMITS = {
  /** A schedule yields at most this many payments (50 years of months). */
  maxPeriods: 600,
  /** A custom list holds at most this many days. */
  maxDates: 120,
  /** "Every N months": N from 1 to 120. */
  maxEveryMonths: 120,
  /** How many coming payments a summary lists. */
  upcoming: 3,
  /** How many past periods a summary lists (newest last). */
  recent: 6,
} as const;

const AmountMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * A recurring schedule: a payment of `amountMinor` (the contract's currency) every interval from
 * `startsOn`, until `endsOn` or, without one, until the contract's end. `everyMonths` only with
 * the `everyMonths` frequency.
 */
const RecurringScheduleSchema = z
  .object({
    frequency: z.enum(['monthly', 'quarterly', 'semiannual', 'yearly', 'everyMonths']),
    everyMonths: z
      .number()
      .int()
      .min(1)
      .max(SCHEDULE_LIMITS.maxEveryMonths)
      .nullable()
      .default(null),
    amountMinor: AmountMinorSchema,
    startsOn: DaySchema,
    endsOn: DaySchema.nullable().default(null),
  })
  .strict()
  .refine((v) => (v.frequency === 'everyMonths') === (v.everyMonths !== null), {
    message: 'every N months needs N, the other frequencies none',
    path: ['everyMonths'],
  })
  .refine((v) => v.endsOn === null || v.endsOn >= v.startsOn, {
    message: 'ends before it starts',
    path: ['endsOn'],
  });

/** A custom list of payment days, each once. */
const DatesScheduleSchema = z
  .object({
    frequency: z.literal('dates'),
    dates: z.array(DaySchema).min(1).max(SCHEDULE_LIMITS.maxDates),
    amountMinor: AmountMinorSchema,
  })
  .strict()
  .refine((v) => new Set(v.dates).size === v.dates.length, {
    message: 'each day once',
    path: ['dates'],
  });

/** A contract's payment schedule as a form sends it; `null` is "none". */
export const ScheduleInputSchema = z.union([RecurringScheduleSchema, DatesScheduleSchema]);
export type ScheduleInput = z.output<typeof ScheduleInputSchema>;

/** A schedule as stored and answered (dates sorted; `everyMonths` the interval, null for dates). */
export const ContractScheduleSchema = z.object({
  frequency: ScheduleFrequencySchema,
  /** Months between payments (1, 3, 6, 12 or N); null for a custom list of days. */
  everyMonths: z.number().int().nullable(),
  amount: MoneySchema,
  startsOn: DaySchema,
  /** The schedule's own end, or null (it then runs until the contract's end). */
  endsOn: DaySchema.nullable(),
  /** A custom list of days, sorted; null for a recurring schedule. */
  dates: z.array(DaySchema).nullable(),
});
export type ContractSchedule = z.infer<typeof ContractScheduleSchema>;

/** What a period's money says: paid, partly paid, unpaid (due and nothing), or still to come. */
export const PeriodStatuses = ['paid', 'partial', 'unpaid', 'upcoming'] as const;
export type PeriodStatus = (typeof PeriodStatuses)[number];

/**
 * One expected payment: due on `dueOn`; the payments dated from `dueOn` up to (not including)
 * `until` count for it. The last period is open (`until` null), so a late payment still counts.
 */
export const SchedulePeriodSchema = z.object({
  dueOn: DaySchema,
  until: DaySchema.nullable(),
  expected: MoneySchema,
  received: MoneySchema,
  status: z.enum(PeriodStatuses),
});
export type SchedulePeriod = z.infer<typeof SchedulePeriodSchema>;

/** A contract's expected payments against what its linked documents received. */
export const ContractPaymentsSchema = z.object({
  periods: z.array(SchedulePeriodSchema),
  /** Expected up to today (due periods), received in total, and still expected after today. */
  dueToDate: MoneySchema,
  received: MoneySchema,
  upcoming: MoneySchema,
  /** The next due day after today, or null when the schedule is over. */
  nextDueOn: DaySchema.nullable(),
  unpaidCount: z.number().int(),
  partialCount: z.number().int(),
});
export type ContractPayments = z.infer<typeof ContractPaymentsSchema>;

/** A contract another one points at (its master, or a child under a master). */
export const ContractRefSchema = z.object({
  id: z.string(),
  /** The contract's client, or null for a contract of several clients. */
  groupId: z.string().nullable(),
  title: z.string(),
  contractNumber: z.string().nullable(),
  startsOn: DaySchema,
  endsOn: DaySchema,
});
export type ContractRef = z.infer<typeof ContractRefSchema>;

/** A payment a linked document records: how much (the contract's currency) and when. */
export const DocumentPaymentSchema = z.object({ amount: MoneySchema, paidOn: DaySchema });
export type DocumentPayment = z.infer<typeof DocumentPaymentSchema>;

/** A document linked to a contract, as the contract lists it. */
export const ContractDocumentSchema = z.object({
  id: z.string(),
  groupId: z.string().nullable(),
  title: z.string(),
  payment: DocumentPaymentSchema.nullable(),
});
export type ContractDocument = z.infer<typeof ContractDocumentSchema>;

/** A document's link, as the document shows it. */
export const ContractLinkSchema = z.object({
  contract: ContractRefSchema,
  payment: DocumentPaymentSchema.nullable(),
});
export type ContractLink = z.infer<typeof ContractLinkSchema>;

/**
 * A document's link as a form sends it: the contract, and optionally the payment it records
 * (an income: the amount in the contract's currency and the day it was paid). `null`: no link.
 */
export const ContractLinkInputSchema = z
  .object({
    contractId: IdSchema,
    payment: z
      .object({ amount: MoneyInputSchema, paidOn: DaySchema })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type ContractLinkInput = z.output<typeof ContractLinkInputSchema>;

/** `GET /api/finance/contract-choices?group=`: the contracts a picker offers. */
export const ContractChoiceSchema = ContractRefSchema.extend({
  /** Its master, or null; a contract with one cannot be a master itself. */
  parentId: z.string().nullable(),
  /** It is a master of at least one contract, so it cannot get one. */
  hasChildren: z.boolean(),
});
export type ContractChoice = z.infer<typeof ContractChoiceSchema>;
export const ContractChoicesSchema = z.array(ContractChoiceSchema);

/** `?group=<id>`: one client's contracts and those shared with it; absent: the organisation's. */
export const ContractChoicesQuerySchema = z.object({ group: IdSchema.optional() });

/**
 * One scheduled contract in an overview (a client's tab or `/finance`): "+600 € každý mesiac",
 * the next payments and whether the latest due periods are paid. In a client's tab a contract of
 * several clients counts that client's part (its share of the whole).
 */
export const ScheduleSummarySchema = z.object({
  contractId: z.string(),
  groupId: z.string().nullable(),
  title: z.string(),
  frequency: ScheduleFrequencySchema,
  everyMonths: z.number().int().nullable(),
  /** Per period, in this view (a share's part on a client's tab). */
  amount: MoneySchema,
  upcoming: z.array(z.object({ dueOn: DaySchema, expected: MoneySchema })),
  recent: z.array(
    z.object({
      dueOn: DaySchema,
      expected: MoneySchema,
      received: MoneySchema,
      status: z.enum(PeriodStatuses),
    }),
  ),
  unpaidCount: z.number().int(),
  partialCount: z.number().int(),
});
export type ScheduleSummary = z.infer<typeof ScheduleSummarySchema>;

/** Expected payments and the payments received, of one currency, by month ("očakávané"). */
export const OverviewExpectedSchema = z.object({
  currency: CurrencySchema,
  expected: z.number().int(),
  received: z.number().int(),
  byMonth: z.array(
    z.object({
      month: MonthSchema,
      expected: z.number().int(),
      received: z.number().int(),
    }),
  ),
});
export type OverviewExpected = z.infer<typeof OverviewExpectedSchema>;

// ---------------------------------------------------------------------------------------------
// The schedule maths
// ---------------------------------------------------------------------------------------------

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The day `months` months after `day`, on the day of the month `anchor` (the schedule's first
 * day), or the month's last day when it is shorter: from 31 January monthly gives 28 (29)
 * February, then 31 March. Anchoring on the first day keeps a short month from shifting the rest.
 */
export function addMonths(day: string, months: number, anchor = Number(day.slice(8, 10))): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(anchor, daysInMonth(y, m)))}`;
}

/** A schedule as the maths needs it (stored or as sent). */
export type ScheduleShape =
  | {
      frequency: Exclude<ScheduleFrequency, 'dates'>;
      everyMonths: number | null;
      startsOn: string;
      endsOn: string | null;
    }
  | { frequency: 'dates'; dates: readonly string[] };

/** Months between payments of a recurring schedule. */
export function intervalMonths(s: { frequency: ScheduleFrequency; everyMonths: number | null }) {
  if (s.frequency === 'everyMonths') return s.everyMonths ?? 1;
  if (s.frequency === 'dates') return null;
  return FREQUENCY_MONTHS[s.frequency];
}

/**
 * The due days of a schedule, each with the day its period ends (exclusive; null for the last,
 * which stays open). A recurring schedule runs from its start, every interval, up to its end or,
 * without one, the contract's end (`contractEndsOn`), both inclusive; at most `maxPeriods` (one
 * more is reported by `tooMany`). A custom list is sorted.
 */
export function scheduleDueDays(
  schedule: ScheduleShape,
  contractEndsOn: string,
): { days: { dueOn: string; until: string | null }[]; tooMany: boolean } {
  let due: string[];
  let tooMany = false;
  if (schedule.frequency === 'dates') {
    due = [...new Set(schedule.dates)].sort();
  } else {
    const step = intervalMonths(schedule)!;
    const end = schedule.endsOn ?? contractEndsOn;
    const anchor = Number(schedule.startsOn.slice(8, 10));
    due = [];
    for (let k = 0; ; k += 1) {
      const day = addMonths(schedule.startsOn, k * step, anchor);
      if (day > end) break;
      if (due.length === SCHEDULE_LIMITS.maxPeriods) {
        tooMany = true;
        break;
      }
      due.push(day);
    }
  }
  return {
    days: due.map((dueOn, i) => ({ dueOn, until: due[i + 1] ?? null })),
    tooMany,
  };
}

/** Why a schedule is refused for a contract: no payment at all, or too many. Null when fine. */
export function scheduleProblem(
  schedule: ScheduleShape,
  contractEndsOn: string,
): 'empty' | 'tooMany' | null {
  const { days, tooMany } = scheduleDueDays(schedule, contractEndsOn);
  if (tooMany) return 'tooMany';
  return days.length === 0 ? 'empty' : null;
}

/** The status of one period: paid when what was received covers what was expected. */
export function periodStatus(
  expectedMinor: number,
  receivedMinor: number,
  dueOn: string,
  today: string,
): PeriodStatus {
  if (dueOn > today)
    return receivedMinor > 0 && receivedMinor >= expectedMinor ? 'paid' : 'upcoming';
  if (receivedMinor >= expectedMinor) return 'paid';
  return receivedMinor > 0 ? 'partial' : 'unpaid';
}

/**
 * A schedule's periods against the payments of the contract's linked documents: each payment
 * counts for the period its day falls in (from a due day up to the next; the last period open).
 * Payments dated before the first due day count for none.
 */
export function schedulePeriods(
  schedule: ScheduleShape & { amountMinor: number },
  contractEndsOn: string,
  payments: readonly { amountMinor: number; paidOn: string }[],
  today: string,
): {
  dueOn: string;
  until: string | null;
  expected: number;
  received: number;
  status: PeriodStatus;
}[] {
  const { days } = scheduleDueDays(schedule, contractEndsOn);
  return days.map(({ dueOn, until }) => {
    const received = payments
      .filter((p) => p.paidOn >= dueOn && (until === null || p.paidOn < until))
      .reduce((sum, p) => sum + p.amountMinor, 0);
    return {
      dueOn,
      until,
      expected: schedule.amountMinor,
      received,
      status: periodStatus(schedule.amountMinor, received, dueOn, today),
    };
  });
}

/**
 * A part of an amount: `amount × part / whole`, rounded half up, in whole minor units (BigInt, so
 * no floating point). A whole of 0 gives 0. A contract of several clients counts a client's part
 * of its schedule this way.
 */
export function partOf(amountMinor: number, part: number, whole: number): number {
  if (whole <= 0) return 0;
  if (part === whole) return amountMinor;
  const n = BigInt(amountMinor) * BigInt(part) * 2n + BigInt(whole);
  return Number(n / (BigInt(whole) * 2n));
}
