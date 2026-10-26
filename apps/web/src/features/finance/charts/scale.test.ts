import { describe, expect, it } from 'vitest';
import { monthAxis, monthName, niceScale } from './scale';

describe('niceScale', () => {
  it.each([
    [1234, 4, 1500, [0, 500, 1000, 1500]],
    [100, 4, 100, [0, 25, 50, 75, 100]],
    [7, 4, 8, [0, 2, 4, 6, 8]],
    [0.3, 2, 0.4, [0, 0.2, 0.4]],
    [95_000, 4, 100_000, [0, 25_000, 50_000, 75_000, 100_000]],
  ])('holds %d in about %d round steps', (max, count, top, ticks) => {
    expect(niceScale(max, count)).toMatchObject({ max: top, ticks });
  });

  it('gives steps of 1 for no data', () => {
    expect(niceScale(0, 2)).toEqual({ max: 2, step: 1, ticks: [0, 1, 2] });
    expect(niceScale(-5, 2).max).toBe(2);
  });
});

describe('monthAxis', () => {
  const months = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const index = from + i;
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    });

  it('labels every month when they fit, the year on the first one and on January', () => {
    const axis = monthAxis(months(2026 * 12 + 9, 6), 'en');
    expect(axis.every((l) => l.show)).toBe(true);
    // ICU's CLDR data decides the year's spelling ("Oct 26" or "Oct ’26"), so only its digits count.
    expect(axis.map((l) => l.label.replace(/\W+/g, ' '))).toEqual([
      'Oct 26',
      'Nov',
      'Dec',
      'Jan 27',
      'Feb',
      'Mar',
    ]);
  });

  it('skips labels instead of rotating them, keeping January', () => {
    const axis = monthAxis(months(2025 * 12 + 10, 24), 'en', 12);
    expect(axis.filter((l) => l.show).map((l) => l.month)).toEqual([
      '2025-11',
      '2026-01',
      '2026-03',
      '2026-05',
      '2026-07',
      '2026-09',
      '2026-11',
      '2027-01',
      '2027-03',
      '2027-05',
      '2027-07',
      '2027-09',
    ]);
    const long = monthAxis(months(2020 * 12, 60), 'en', 6);
    expect(long.filter((l) => l.show).every((l) => l.month.endsWith('-01'))).toBe(true);
  });

  it('names a month in the UI language', () => {
    expect(monthName('2026-10', 'en')).toBe('October 2026');
    expect(monthName('2026-10', 'sk')).toMatch(/október 2026/);
  });
});
