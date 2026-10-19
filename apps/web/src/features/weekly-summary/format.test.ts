import { describe, expect, it } from 'vitest';
import { isoWeek, rangeLabel, shiftWeek, weekMonday, weekRangeLabel } from './format';

describe('weekly summary weeks', () => {
  it('computes ISO weeks in Bratislava time and moves between them', () => {
    expect(isoWeek(new Date('2026-10-18T22:30:00Z'))).toBe('2026-W43');
    expect(shiftWeek('2026-W43', -1)).toBe('2026-W42');
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    expect(weekMonday('2026-W43').toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('writes ranges as the Slovak source does', () => {
    expect(
      rangeLabel('sk', new Date('2026-10-13T08:00:00Z'), new Date('2026-10-17T08:00:00Z')),
    ).toBe('13. 10. – 17. 10. 2026');
    expect(weekRangeLabel('sk', '2026-W42')).toBe('12. 10. – 16. 10. 2026');
  });
});
