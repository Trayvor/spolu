import { describe, expect, it } from 'vitest';
import { ReminderPutSchema } from './reminders.js';

const at = (minutes: number) => new Date(Date.UTC(2030, 0, 1, 9, minutes)).toISOString();

describe('ReminderPutSchema', () => {
  it('ReminderPutSchema accepts zero times and no recipientIds', () => {
    const parsed = ReminderPutSchema.parse({ times: [] });
    expect(parsed.times).toEqual([]);
    expect(parsed.recipientIds).toBeUndefined();
    expect(parsed.baseTimeIds).toEqual([]);
  });

  it('ReminderPutSchema refuses 21 times', () => {
    const times = Array.from({ length: 21 }, (_, i) => ({ at: at(i) }));
    expect(ReminderPutSchema.safeParse({ times }).success).toBe(false);
    expect(ReminderPutSchema.safeParse({ times: times.slice(0, 20) }).success).toBe(true);
  });

  it('deduplicates recipientIds and refuses two times at one instant', () => {
    const parsed = ReminderPutSchema.parse({ times: [], recipientIds: ['a', 'a', 'b'] });
    expect(parsed.recipientIds).toEqual(['a', 'b']);
    expect(
      ReminderPutSchema.safeParse({
        times: [{ at: '2030-01-01T10:00:00+01:00' }, { at: '2030-01-01T09:00:00Z' }],
      }).success,
    ).toBe(false);
  });
});
