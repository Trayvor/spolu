import { describe, expect, it } from 'vitest';
import { formatReminderDate, formatReminderTime, leafParts } from './format';

const now = new Date(2026, 9, 21, 10, 0); // Wed 21 Oct 2026, local
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

describe('reminder formatting', () => {
  it('today and tomorrow are named', () => {
    expect(formatReminderTime(at(21, 14), 'en', now)).toBe('Today, 14:00');
    expect(formatReminderTime(at(22, 9), 'en', now)).toBe('Tomorrow, 09:00');
    expect(formatReminderTime(at(23, 14), 'en', now)).toBe('Fri 23 Oct, 14:00');
    expect(formatReminderDate(at(23, 14), 'en')).toBe('Fri 23 Oct 2026, 14:00');
  });

  it('sk weekday and month', () => {
    const text = formatReminderTime(at(23, 14), 'sk', now);
    expect(text).toMatch(/^pi 23\. okt/);
    expect(text).toMatch(/14:00$/);
    expect(formatReminderTime(at(21, 14), 'sk', now)).toBe('Dnes, 14:00');
    expect(leafParts(at(23, 14), 'sk')).toEqual({ day: '23', month: 'okt' });
    expect(leafParts(at(23, 14), 'en')).toEqual({ day: '23', month: 'Oct' });
  });
});
