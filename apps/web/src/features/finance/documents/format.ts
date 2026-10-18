import {
  CONTRACT_REMINDER_DAYS_BEFORE,
  EXPENSE_REMINDER_DAYS_BEFORE,
  FINANCE_LIMITS,
} from '@spolu/shared';
import { localDate, localToIso } from '@/features/reminders/reminder-times-field';

/** Pure helpers of the Documents card (Phase 32 part B). Days are `YYYY-MM-DD`. */

const DAY_MS = 86_400_000;

const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `day` plus `days` (negative: earlier). */
export function addDays(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * DAY_MS);
}

/** A calendar day in the UI language: sk "31. 12. 2026", en "31/12/2026". */
export function formatDay(day: string, language: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return at.toLocaleDateString(/^en\b/.test(language) ? 'en-GB' : language, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A contract's period, "1. 1. 2026 – 31. 12. 2026". */
export function formatPeriod(startsOn: string, endsOn: string, language: string): string {
  return `${formatDay(startsOn, language)} – ${formatDay(endsOn, language)}`;
}

/** "Ending soon": the end is today or within the next 60 days. */
export function isEndingSoon(endsOn: string, today: string): boolean {
  return endsOn >= today && endsOn <= addDays(today, FINANCE_LIMITS.endingSoonDays);
}

/** The contract's last day has passed. */
export function hasEnded(endsOn: string, today: string): boolean {
  return endsOn < today;
}

/** Today in the browser's time zone. */
export const today = (now = new Date()) => localDate(now);

/**
 * The reminder a new contract's form proposes (owner decision 14): 30 days before its end at
 * 09:00 local time; null when that moment has already passed (a contract ending within a month).
 */
export function proposedReminder(
  endsOn: string,
  now = new Date(),
): { date: string; time: string } | null {
  return proposalBefore(endsOn, CONTRACT_REMINDER_DAYS_BEFORE, now);
}

/**
 * The reminder a new expense's form proposes (Phase 32 E, decision E5): the day before its date
 * at 09:00 local time; null when that moment has passed.
 */
export function proposedExpenseReminder(
  spentOn: string,
  now = new Date(),
): { date: string; time: string } | null {
  return proposalBefore(spentOn, EXPENSE_REMINDER_DAYS_BEFORE, now);
}

function proposalBefore(day: string, days: number, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = addDays(day, -days);
  const iso = localToIso(date, '09:00');
  if (!iso || Date.parse(iso) <= now.getTime() + 60_000) return null;
  return { date, time: '09:00' };
}

/** What a list or a sheet calls an item: a salary without a title is "Salary: <admin>". */
export function itemTitle(
  item: { title: string; expense: { kind: string; payeeName: string | null } | null },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (item.expense?.kind !== 'salary') return item.title;
  const salary = t('financeOrg.row.salary', { name: item.expense.payeeName ?? '' });
  return item.title ? `${salary}: ${item.title}` : salary;
}
