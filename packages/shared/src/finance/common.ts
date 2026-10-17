import { z } from 'zod';
import { IdSchema } from '../chat.js';
import { MAX_ENTRY_MINUTES } from '../duration.js';

/**
 * Finance (Phase 32): what every part shares — events, months, days, minutes, the client filter.
 * Part A1 owns this file. Spec: docs/superpowers/specs/2026-10-17-finance-module-design.md.
 */

/** Socket events. `finance:changed` goes to the `finance` room only; the others to `user:<id>`. */
export const FinanceEvents = {
  changed: 'finance:changed',
  timeRequests: 'time:requests',
  meChanged: 'me:changed',
} as const;

/** What a `finance:changed` touched: items and folders, time entries, or hourly rates. */
export const FinanceChangeKinds = ['items', 'time', 'rates'] as const;
export type FinanceChangeKind = (typeof FinanceChangeKinds)[number];

/** `finance:changed`: `groupId` null for a change of no one client (rates). */
export const FinanceChangedEventSchema = z.object({
  groupId: z.string().nullable(),
  kind: z.enum(FinanceChangeKinds),
});
export type FinanceChangedEvent = z.infer<typeof FinanceChangedEventSchema>;

/** `time:requests`: the user's count of open time requests changed. */
export const TimeRequestsEventSchema = z.object({ count: z.number().int().min(0) });
export type TimeRequestsEvent = z.infer<typeof TimeRequestsEventSchema>;

/** A month in Europe/Bratislava, `YYYY-MM`. */
export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export type Month = z.infer<typeof MonthSchema>;

/** A calendar day in Europe/Bratislava, `YYYY-MM-DD` (checked to exist). */
export const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
export type Day = z.infer<typeof DaySchema>;

/** Minutes of one time entry: 0 ("no time") up to 100 h. */
export const MinutesSchema = z.number().int().min(0).max(MAX_ENTRY_MINUTES);

/** An inclusive month range, `from` <= `to` (`?from=&to=`). */
export const MonthRangeQuerySchema = z
  .object({ from: MonthSchema, to: MonthSchema })
  .refine((r) => r.from <= r.to, { message: 'from after to' });
export type MonthRangeQuery = z.infer<typeof MonthRangeQuerySchema>;

/** Most clients a `clients=` filter may name. */
export const FINANCE_MAX_CLIENTS = 200;

/** `clients=`: a comma list of group ids; missing or empty means every client. */
export const FinanceClientsFilterSchema = z
  .string()
  .max(FINANCE_MAX_CLIENTS * 65)
  .optional()
  .transform((value) => (value ? [...new Set(value.split(',').filter(Boolean))] : []))
  .pipe(z.array(IdSchema).max(FINANCE_MAX_CLIENTS));
