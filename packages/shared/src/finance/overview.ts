import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { CurrencySchema } from '../money.js';
import { DaySchema, MinutesSchema, MonthSchema } from './common.js';
import { OverviewExpectedSchema, ScheduleSummarySchema } from './contracts.js';
import {
  eventWithoutProject,
  FinanceProjectIdSchema,
  manualEntryProjectFields,
} from './projects.js';

/**
 * Overview, work log, rates and manual entries (Phase 32 part C, spec §6.1–6.3). Money is in
 * minor units; every cost is in `COST_CURRENCY` (EUR). Written by A1, refined by C only.
 */

export const WORK_LOG_PAGE_SIZE = 200;

/** Cost and hours of one admin (or of a month's admin line). `cost` null: no rate applies. */
export const AdminTimeSchema = z.object({
  userId: z.string(),
  name: z.string(),
  minutes: z.number().int(),
  taskCount: z.number().int(),
  /** Tickets with time of this admin (2026-10-17); a ticket and its linked tasks count apart. */
  ticketCount: z.number().int(),
  /** Minor units of EUR; null when none of the minutes has a rate. */
  cost: z.number().int().nullable(),
  /** Minutes without an applicable rate (counted in `minutes`, missing from `cost`). */
  missingRateMinutes: z.number().int(),
});
export type AdminTime = z.infer<typeof AdminTimeSchema>;

/** Money of one currency: paid (start date today or earlier) and to be paid, by month. */
export const OverviewMoneySchema = z.object({
  currency: CurrencySchema,
  paid: z.number().int(),
  toBePaid: z.number().int(),
  byMonth: z.array(
    z.object({ month: MonthSchema, paid: z.number().int(), toBePaid: z.number().int() }),
  ),
});
export type OverviewMoney = z.infer<typeof OverviewMoneySchema>;

/**
 * The organisation's money out of one currency (Phase 32 E, decisions O3, E6, E17): expenses
 * dated today or earlier are paid out (salaries and the rest apart), later ones planned.
 */
export const OverviewExpensesSchema = z.object({
  currency: CurrencySchema,
  paidOut: z.number().int(),
  /** The part of `paidOut` that is admins' salaries; the rest is other expenses. */
  salaryPaidOut: z.number().int(),
  planned: z.number().int(),
  byMonth: z.array(
    z.object({ month: MonthSchema, paidOut: z.number().int(), planned: z.number().int() }),
  ),
});
export type OverviewExpenses = z.infer<typeof OverviewExpensesSchema>;

/**
 * `GET /api/groups/:id/finance/overview?from=&to=` (and D's `/api/finance/overview`). `months`
 * lists every month of the range in order; series leave out months with nothing.
 */
export const FinanceOverviewDtoSchema = z.object({
  from: MonthSchema,
  to: MonthSchema,
  months: z.array(MonthSchema),
  /**
   * True on `/finance` with every client chosen (Phase 32 E): the organisation's expenses count,
   * and the balance is paid − expenses paid out. False in a client's tab and for chosen clients.
   */
  organisation: z.boolean(),
  /** One entry per currency with expenses in the range; empty unless `organisation`. */
  expenses: z.array(OverviewExpensesSchema),
  /** One entry per currency that has contracts in the range, EUR first. */
  money: z.array(OverviewMoneySchema),
  /**
   * Contracts' payment schedules (ADR 0066), "očakávané": the payments due in each month of the
   * range against those the linked documents received, per currency (EUR first); and each
   * scheduled contract's summary. Counted apart from `money` (a contract's whole amount).
   */
  expected: z.array(OverviewExpectedSchema).optional(),
  schedules: z.array(ScheduleSummarySchema).optional(),
  /** The cost of the work (hours × rates), EUR. */
  cost: z.object({
    total: z.number().int(),
    byMonth: z.array(z.object({ month: MonthSchema, amount: z.number().int() })),
  }),
  hours: z.object({
    minutes: z.number().int(),
    taskCount: z.number().int(),
    ticketCount: z.number().int(),
    missingRateMinutes: z.number().int(),
    /** By total minutes, most first. */
    byAdmin: z.array(
      AdminTimeSchema.extend({
        byMonth: z.array(z.object({ month: MonthSchema, minutes: z.number().int() })),
      }),
    ),
  }),
});
export type FinanceOverviewDto = z.infer<typeof FinanceOverviewDtoSchema>;

export const TimeEntrySources = ['task', 'ticket', 'manual'] as const;
export type TimeEntrySource = (typeof TimeEntrySources)[number];

/**
 * One entry of the work log. `minutes` null: requested, not filled yet ("waiting for time").
 * `unitTicketId` groups a ticket with the tasks made from it (spec §6.1, 2026-10-17): the ticket
 * entry itself (`ticketId`) or a task entry of a linked task (`linkedTicketId`); the card shows
 * the ticket header with its own hours and the linked tasks under it. Totals never double count:
 * each row's minutes count once, an entry `coveredByTasks` holds 0.
 */
export const WorkLogEntrySchema = z.object({
  id: z.string(),
  /** Null only on the all-clients work log (D): time without a client ("Bez klienta"). */
  groupId: z.string().nullable(),
  /** Set on the system-wide work log (D), where entries of several clients mix; null without one. */
  groupName: z.string().nullable().optional(),
  userId: z.string(),
  userName: z.string(),
  source: z.enum(TimeEntrySources),
  taskId: z.string().nullable(),
  ticketId: z.string().nullable(),
  /** A task entry's ticket (the task was made from it). */
  linkedTicketId: z.string().nullable(),
  /** `ticketId ?? linkedTicketId`: the ticket unit the row belongs to. */
  unitTicketId: z.string().nullable(),
  /** The live title of the task or ticket, or the stored one of a deleted subject. */
  title: z.string().nullable(),
  /** The task or ticket was deleted (the row keeps its stored title). */
  subjectDeleted: z.boolean(),
  /** A ticket entry answered "the linked tasks cover it" (0 minutes). */
  coveredByTasks: z.boolean(),
  minutes: z.number().int().nullable(),
  workedOn: DaySchema,
  note: z.string(),
  cost: z.number().int().nullable(),
  /** The entry's project and event (Phase 33 P6): its task's or ticket's copy, or a manual one's. */
  projectId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
});
export type WorkLogEntry = z.infer<typeof WorkLogEntrySchema>;

/** The full totals of one month the page touches (the month header row). */
export const WorkLogMonthSchema = z.object({
  month: MonthSchema,
  minutes: z.number().int(),
  taskCount: z.number().int(),
  ticketCount: z.number().int(),
  cost: z.number().int().nullable(),
  missingRateMinutes: z.number().int(),
  byAdmin: z.array(AdminTimeSchema),
  /** System-wide work log (D): the clients with the most minutes that month. */
  topClients: z
    .array(
      z.object({ groupId: z.string().nullable(), name: z.string(), minutes: z.number().int() }),
    )
    .optional(),
});
export type WorkLogMonth = z.infer<typeof WorkLogMonthSchema>;

/** The period's summary above the chronology (first page only). */
export const WorkLogSummarySchema = z.object({
  minutes: z.number().int(),
  taskCount: z.number().int(),
  ticketCount: z.number().int(),
  cost: z.number().int().nullable(),
  missingRateMinutes: z.number().int(),
  byAdmin: z.array(AdminTimeSchema),
});
export type WorkLogSummary = z.infer<typeof WorkLogSummarySchema>;

/**
 * `GET /api/groups/:id/finance/work-log?from=&to=&before=`: up to 200 entries, newest first
 * from the server (keyset `worked_on desc, id desc`; the card shows them oldest at the top).
 * `before` is the cursor of the previous (older) page, null at the start of the data.
 */
export const WorkLogPageDtoSchema = z.object({
  entries: z.array(WorkLogEntrySchema),
  /** The tickets the page's units belong to (number and live title), once each. */
  tickets: z.array(
    z.object({
      id: z.string(),
      number: z.number().int(),
      title: z.string(),
    }),
  ),
  months: z.array(WorkLogMonthSchema),
  summary: WorkLogSummarySchema.nullable(),
  before: z.string().nullable(),
});
export type WorkLogPageDto = z.infer<typeof WorkLogPageDtoSchema>;

/**
 * `?from=&to=` of the overview: both months or neither ("all time": the server answers the
 * months its data spans, at most ten years). The answer's `from` and `to` say which it used.
 */
export const OverviewQuerySchema = z
  .object({ from: MonthSchema.optional(), to: MonthSchema.optional() })
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'from and to' })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from after to',
  });
export type OverviewQuery = z.infer<typeof OverviewQuerySchema>;

/** The most months one overview spans (ten years; the series stay small). */
export const OVERVIEW_MAX_MONTHS = 120;

/** `?from=&to=&before=` of the work log: both months or neither (all time). */
export const WorkLogQuerySchema = z
  .object({
    from: MonthSchema.optional(),
    to: MonthSchema.optional(),
    before: z.string().min(1).max(200).optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'from and to' })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from after to',
  });
export type WorkLogQuery = z.infer<typeof WorkLogQuerySchema>;

const NoteSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v.includes('\0'))
  .default('');

/** `POST /api/groups/:id/finance/time-entries`: a manual entry ("admin X spent N on day D"). */
const manualEntryFields = {
  userId: IdSchema,
  workedOn: DaySchema,
  minutes: MinutesSchema,
  note: NoteSchema,
  // Phase 33 P6: the client's project and event the time was for (optional).
  ...manualEntryProjectFields,
};
const eventNeedsProject = { message: 'an event needs its project' };

export const ManualEntryBodySchema = z
  .object(manualEntryFields)
  .strict()
  .refine((v) => !eventWithoutProject(v), eventNeedsProject);
export type ManualEntryBody = z.output<typeof ManualEntryBodySchema>;

/**
 * `POST /api/finance/time-entries` ("Add time" on `/finance`): a manual entry for the chosen
 * client, or without one (`groupId` null, "Bez klienta", decision 24, migration 0041).
 */
export const SystemManualEntryBodySchema = z
  .object({ ...manualEntryFields, groupId: IdSchema.nullable() })
  .strict()
  .refine((v) => !eventWithoutProject(v), eventNeedsProject);
export type SystemManualEntryBody = z.output<typeof SystemManualEntryBodySchema>;

/**
 * `PATCH /api/finance/time-entries/:id`: a task or ticket entry takes `minutes` only (a ticket
 * entry given minutes stops being `coveredByTasks`).
 */
export const TimeEntryPatchSchema = z
  .object({
    minutes: MinutesSchema.optional(),
    workedOn: DaySchema.optional(),
    note: z.string().trim().max(500).optional(),
    /** A manual entry's project and event (Phase 33 P6); `projectId: null` clears both. */
    projectId: FinanceProjectIdSchema.nullable().optional(),
    eventId: FinanceProjectIdSchema.nullable().optional(),
  })
  .strict();
export type TimeEntryPatch = z.infer<typeof TimeEntryPatchSchema>;

/** One hourly rate row. `effectiveFrom` null: "from the start" (the admin's first rate). */
export const RateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  rateMinor: z.number().int(),
  currency: CurrencySchema,
  effectiveFrom: DaySchema.nullable(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
});
export type Rate = z.infer<typeof RateSchema>;

/** `GET /api/finance/rates`: every admin with their current rate and history (newest first). */
export const RatesDtoSchema = z.object({
  admins: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      active: z.boolean(),
      current: RateSchema.nullable(),
      history: z.array(RateSchema),
    }),
  ),
});
export type RatesDto = z.infer<typeof RatesDtoSchema>;

/** `POST /api/finance/rates` (EUR). */
export const AddRateBodySchema = z
  .object({
    userId: IdSchema,
    rateMinor: z.number().int().min(1).max(100_000_000),
    effectiveFrom: DaySchema.nullable(),
  })
  .strict();
export type AddRateBody = z.infer<typeof AddRateBodySchema>;
