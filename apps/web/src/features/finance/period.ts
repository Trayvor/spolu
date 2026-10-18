import type { Month } from '@spolu/shared';

/**
 * The finance cards' period filters (spec §6.1, decision 18): presets that turn into an
 * inclusive Bratislava month range, `null` for all time. The overview opens on the last 12 and
 * the next 12 months, the work log on all time; `/finance` has one period for every card.
 */

export type MonthRange = { from: Month; to: Month };

export const OVERVIEW_PERIODS = ['next12', 'thisYear', 'lastYear', 'allTime', 'custom'] as const;
export const WORK_LOG_PERIODS = [
  'allTime',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'lastYear',
  'custom',
] as const;
/** `/finance`'s one period for every card (this year first, the rankings' old default). */
export const PAGE_PERIODS = [
  'thisYear',
  'lastYear',
  'thisMonth',
  'lastMonth',
  'next12',
  'allTime',
  'custom',
] as const;
export type Period = (typeof OVERVIEW_PERIODS)[number] | (typeof WORK_LOG_PERIODS)[number];

/** This month in Europe/Bratislava. */
export function currentMonth(now: Date = new Date()): Month {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' })
    .format(now)
    .slice(0, 7);
}

/** Today in Europe/Bratislava, `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

/** `2026-10` moved by `count` months (negative: back). */
function addMonths(month: Month, count: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The months of a preset; `custom` takes `custom` (null when it is not complete or reversed). */
export function rangeOf(
  period: Period,
  custom: { from: string; to: string } | null = null,
  now: Date = new Date(),
): MonthRange | null {
  const month = currentMonth(now);
  const year = month.slice(0, 4);
  switch (period) {
    case 'next12':
      return { from: addMonths(month, -11), to: addMonths(month, 12) };
    case 'thisMonth':
      return { from: month, to: month };
    case 'lastMonth': {
      const last = addMonths(month, -1);
      return { from: last, to: last };
    }
    case 'thisYear':
      return { from: `${year}-01`, to: `${year}-12` };
    case 'lastYear': {
      const last = String(Number(year) - 1);
      return { from: `${last}-01`, to: `${last}-12` };
    }
    case 'custom':
      return custom && /^\d{4}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}$/.test(custom.to)
        ? custom.from <= custom.to
          ? { from: custom.from, to: custom.to }
          : { from: custom.to, to: custom.from }
        : null;
    case 'allTime':
      return null;
  }
}
