import { describe, expect, it } from 'vitest';
import {
  fromZonedTime,
  latestSeriesEnd,
  MeetingRepeatSchema,
  occurrenceStart,
  weekdayOrdinal,
  withinSeriesEnd,
  zonedDay,
  zonedTime,
  type SeriesRule,
} from './meeting-series.js';

const TZ = 'Europe/Bratislava';
const rule = (frequency: SeriesRule['frequency'], iso: string): SeriesRule => ({
  frequency,
  timeZone: TZ,
  anchorStartsAt: new Date(iso),
  anchorIndex: 0,
});
const local = (date: Date) => {
  const t = zonedTime(date, TZ);
  return `${zonedDay(date, TZ)} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
};

describe('meeting series dates', () => {
  it('keeps the local time across daylight saving time (weekly)', () => {
    // Monday 2026-10-19 10:00 CEST (+02:00); DST ends on 2026-10-25.
    const r = rule('weekly', '2026-10-19T08:00:00Z');
    expect(local(occurrenceStart(r, 0))).toBe('2026-10-19 10:00');
    expect(local(occurrenceStart(r, 1))).toBe('2026-10-26 10:00');
    expect(occurrenceStart(r, 1).toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });

  it('every two weeks', () => {
    const r = rule('biweekly', '2026-10-19T08:00:00Z');
    expect(local(occurrenceStart(r, 2))).toBe('2026-11-16 10:00');
  });

  it('monthly on the same date, the last day when a month lacks it', () => {
    const r = rule('monthly_date', '2027-01-31T09:00:00Z');
    expect(local(occurrenceStart(r, 1))).toBe('2027-02-28 10:00');
    expect(local(occurrenceStart(r, 2))).toBe('2027-03-31 10:00');
    expect(local(occurrenceStart(r, 11))).toBe('2027-12-31 10:00');
    expect(local(occurrenceStart(r, 12))).toBe('2028-01-31 10:00');
  });

  it('monthly on the same weekday: the 3rd Tuesday, and the last Friday', () => {
    // Tuesday 2026-10-20 is the third Tuesday of October.
    const third = rule('monthly_weekday', '2026-10-20T07:30:00Z');
    expect(local(occurrenceStart(third, 1))).toBe('2026-11-17 09:30');
    expect(local(occurrenceStart(third, 2))).toBe('2026-12-15 09:30');
    // Friday 2026-10-30 is the fifth (last) Friday.
    const last = rule('monthly_weekday', '2026-10-30T13:00:00Z');
    expect(local(occurrenceStart(last, 1))).toBe('2026-11-27 14:00');
    expect(local(occurrenceStart(last, 3))).toBe('2027-01-29 14:00');
    expect(weekdayOrdinal(30)).toBe('last');
    expect(weekdayOrdinal(20)).toBe(3);
  });

  it('follows a re-anchored rule from the anchor on', () => {
    const r: SeriesRule = { ...rule('weekly', '2026-11-03T13:00:00Z'), anchorIndex: 2 };
    expect(local(occurrenceStart(r, 2))).toBe('2026-11-03 14:00');
    expect(local(occurrenceStart(r, 4))).toBe('2026-11-17 14:00');
  });

  it('ends by count or by the last day (inclusive, local)', () => {
    const end = { until: '2026-11-02', count: null, timeZone: TZ };
    expect(withinSeriesEnd(end, 2, new Date('2026-11-02T23:30:00Z'))).toBe(false);
    expect(withinSeriesEnd(end, 2, new Date('2026-11-02T20:00:00Z'))).toBe(true);
    const counted = { until: null, count: 3, timeZone: TZ };
    expect(withinSeriesEnd(counted, 2, new Date())).toBe(true);
    expect(withinSeriesEnd(counted, 3, new Date())).toBe(false);
    expect(latestSeriesEnd(new Date('2028-02-29T10:00:00Z'), TZ)).toBe('2030-02-28');
  });

  it('converts a local time that DST skips forward', () => {
    const t = fromZonedTime({ year: 2027, month: 3, day: 28, hour: 2, minute: 30, second: 0 }, TZ);
    expect(local(t)).toBe('2027-03-28 03:30');
  });

  it('validates the rule', () => {
    const ok = MeetingRepeatSchema.safeParse({ frequency: 'weekly', timeZone: TZ });
    expect(ok.success && ok.data).toEqual({
      frequency: 'weekly',
      timeZone: TZ,
      until: null,
      count: null,
    });
    expect(
      MeetingRepeatSchema.safeParse({ frequency: 'weekly', timeZone: 'Mars/Base' }).success,
    ).toBe(false);
    expect(
      MeetingRepeatSchema.safeParse({
        frequency: 'weekly',
        timeZone: TZ,
        until: '2027-01-01',
        count: 3,
      }).success,
    ).toBe(false);
    expect(
      MeetingRepeatSchema.safeParse({ frequency: 'weekly', timeZone: TZ, count: 1 }).success,
    ).toBe(false);
  });
});
