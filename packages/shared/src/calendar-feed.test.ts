import { describe, expect, it } from 'vitest';
import { CalendarFeedAnswerSchema, CalendarFeedPutBodySchema } from './calendar-feed.js';

describe('calendar feed schemas', () => {
  it('accepts three booleans and refuses anything else', () => {
    expect(
      CalendarFeedPutBodySchema.safeParse({ include: { events: true, tasks: false, calls: false } })
        .success,
    ).toBe(true);
    expect(
      CalendarFeedPutBodySchema.safeParse({
        include: { events: true, tasks: 'managed', calls: true },
      }).success,
    ).toBe(false);
    expect(
      CalendarFeedPutBodySchema.safeParse({
        include: { events: true, tasks: true, calls: true, x: 1 },
      }).success,
    ).toBe(false);
    expect(CalendarFeedPutBodySchema.safeParse({}).success).toBe(false);
  });

  it('an answer carries a feed or null', () => {
    expect(CalendarFeedAnswerSchema.parse({ feed: null })).toEqual({ feed: null });
    const feed = {
      url: 'https://h/api/public/calendar/x/help.ics',
      webcalUrl: 'webcal://h/api/public/calendar/x/help.ics',
      googleUrl: 'https://calendar.google.com/calendar/r?cid=webcal',
      include: { events: true, tasks: true, calls: false },
      createdAt: '2026-10-19T10:00:00.000Z',
      lastFetchedAt: null,
    };
    expect(CalendarFeedAnswerSchema.parse({ feed }).feed).toEqual(feed);
  });
});
