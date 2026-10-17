import type { Month } from '@spolu/shared';

/**
 * Chart helpers (ADR 0028, hand-written SVG charts): round axis ticks and month labels. Pure, so
 * the bars stay simple geometry. Part D reuses them.
 */

export type NiceScale = { max: number; step: number; ticks: number[] };

/**
 * A y axis from 0 that holds `max` with about `count` round steps (1, 2, 2.5 or 5 × 10ⁿ):
 * `niceScale(1234)` is 0, 500, 1 000, 1 500. A `max` of 0 or less gives the steps of 1.
 */
export function niceScale(max: number, count = 4): NiceScale {
  if (!(max > 0))
    return { max: count, step: 1, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= rough) ?? 10 * power;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + step / 1e6; i++) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { max: top, step, ticks };
}

export type MonthLabel = { month: Month; label: string; show: boolean };

/**
 * The labels of a month axis: the short month name, with the year on January and on the first
 * month. Never rotated: with more months than `fit`, only every n-th shows (n = 2, 3, 4, 6 or 12,
 * so January stays among the shown ones when it can).
 */
export function monthAxis(months: readonly Month[], locale: string, fit = 12): MonthLabel[] {
  const name = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const withYear = new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
  const every =
    months.length <= fit ? 1 : ([2, 3, 4, 6, 12].find((n) => months.length / n <= fit) ?? 12);
  return months.map((month, i) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    const january = month.endsWith('-01');
    return {
      month,
      label: (i === 0 || january ? withYear : name).format(date),
      show: (Number(month.slice(5)) - 1) % every === 0,
    };
  });
}

/** The long name of a month for headers and tooltips: "October 2026". */
export function monthName(month: Month, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
