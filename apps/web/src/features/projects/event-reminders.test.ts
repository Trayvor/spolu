import { describe, expect, it } from 'vitest';
import { eventReminderDate } from './event-reminders';

describe('eventReminderDate (F15)', () => {
  const now = new Date(2026, 9, 18, 12, 0); // 18 Oct 2026, local

  it('proposes the day before the event while that is still ahead', () => {
    expect(eventReminderDate('2026-11-04', now)).toBe('2026-11-03');
    expect(eventReminderDate('2026-11-01', now)).toBe('2026-10-31');
  });

  it('proposes today for an event tomorrow, today or in the past', () => {
    expect(eventReminderDate('2026-10-19', now)).toBe('2026-10-18');
    expect(eventReminderDate('2026-10-18', now)).toBe('2026-10-18');
    expect(eventReminderDate('2026-09-01', now)).toBe('2026-10-18');
  });
});
