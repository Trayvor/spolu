import { describe, expect, it } from 'vitest';
import { searchText } from './search-text.js';
import { isoWeek, rangeText, windowFor } from './week.js';

const DAY = 86_400_000;

describe('weekly summary weeks and windows', () => {
  it('isoWeek uses Bratislava time', () => {
    expect(isoWeek(new Date('2026-10-18T22:30:00Z'))).toBe('2026-W43'); // Monday 00:30 there
    expect(isoWeek(new Date('2026-10-18T21:30:00Z'))).toBe('2026-W42'); // still Sunday there
    expect(isoWeek(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
  });

  it('windowFor starts at the previous end', () => {
    const now = new Date('2026-10-23T05:00:00Z');
    const previous = new Date(now.getTime() - 3 * DAY);
    expect(windowFor(previous, now)).toEqual({ start: previous, end: now });
  });

  it('windowFor caps a gap at 14 days', () => {
    const now = new Date('2026-10-23T05:00:00Z');
    expect(windowFor(new Date(now.getTime() - 30 * DAY), now).start).toEqual(
      new Date(now.getTime() - 14 * DAY),
    );
    expect(windowFor(null, now).start).toEqual(new Date(now.getTime() - 7 * DAY));
  });

  it('rangeText in sk and en', () => {
    const start = new Date('2026-10-13T08:00:00Z');
    const end = new Date('2026-10-17T08:00:00Z');
    expect(rangeText('sk', start, end)).toBe('13. 10. – 17. 10. 2026');
    expect(rangeText('en', start, end)).toBe('13/10 – 17/10/2026');
    expect(
      rangeText('sk', new Date('2026-12-28T08:00:00Z'), new Date('2027-01-02T08:00:00Z')),
    ).toBe('28. 12. 2026 – 2. 1. 2027');
  });

  it('searchText joins intro, items and closing', () => {
    const item = (text: string) => ({ id: crypto.randomUUID(), ref: null, text });
    expect(
      searchText({
        intro: 'Úvod',
        done: [item('A')],
        waiting: [item('B')],
        upcoming: [item('C')],
        closing: ' ',
      }),
    ).toBe('Úvod\nA\nB\nC');
  });
});
