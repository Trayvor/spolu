import { z } from 'zod';

// Recurring calls (ADR 0049): a call ("meeting" knowledge item) may repeat weekly, every two
// weeks, or monthly on the same date or the same weekday. The rule is stored on a series; each
// occurrence is a call item of its own, created ahead of time by the series job. The date math
// lives here so the server (materialising) and the web (preview, labels) agree.

export const MeetingRepeatFrequencies = [
  'weekly',
  'biweekly',
  'monthly_date',
  'monthly_weekday',
] as const;
export type MeetingRepeatFrequency = (typeof MeetingRepeatFrequencies)[number];

export const MEETING_SERIES_LIMITS = {
  /** Calls of a series with a count (the first included). */
  minCount: 2,
  maxCount: 100,
  /** An end date at most this many years after the first call. */
  maxYearsAhead: 2,
  /** Occurrences are created this many days ahead (the job keeps the window filled). */
  horizonDays: 60,
  /** The first call of a new series may lie at most this many days in the past. */
  maxPastDays: 7,
} as const;

/** "This call" or "this and the following calls" of a series, for an edit or a delete. */
export const MeetingSeriesScopes = ['this', 'following'] as const;
export type MeetingSeriesScope = (typeof MeetingSeriesScopes)[number];
export const MeetingSeriesScopeSchema = z.enum(MeetingSeriesScopes);

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * How a new call repeats. `timeZone` is the creator's (the browser's): the calls keep their
 * local time across daylight saving time. At most one of `until` (the last day, inclusive, in
 * that zone) and `count` (calls in all); neither means the series runs until it is ended.
 */
export const MeetingRepeatSchema = z
  .object({
    frequency: z.enum(MeetingRepeatFrequencies),
    timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
    until: isoDate.nullable().default(null),
    count: z
      .number()
      .int()
      .min(MEETING_SERIES_LIMITS.minCount)
      .max(MEETING_SERIES_LIMITS.maxCount)
      .nullable()
      .default(null),
  })
  .strict()
  .refine((r) => r.until === null || r.count === null, 'Either an end date or a count');
export type MeetingRepeat = z.output<typeof MeetingRepeatSchema>;
export type MeetingRepeatInput = z.input<typeof MeetingRepeatSchema>;

/** What the detail of an occurrence tells about its series. */
export const MeetingSeriesInfoSchema = z.object({
  id: z.string(),
  frequency: z.enum(MeetingRepeatFrequencies),
  timeZone: z.string(),
  until: z.string().nullable(),
  count: z.number().int().nullable(),
  /** This call's place in the series, 0 for the first. */
  index: z.number().int(),
  /** Calls of the series after this one that exist already. */
  followingCount: z.number().int(),
  /** No further call will be created (the end was reached or the series was ended). */
  ended: z.boolean(),
});
export type MeetingSeriesInfo = z.infer<typeof MeetingSeriesInfoSchema>;

// ---------------------------------------------------------------------------------------------
// Local time in a zone
// ---------------------------------------------------------------------------------------------

/** A wall-clock time in some zone; `month` is 1 to 12. */
export type LocalTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** The wall-clock time of `date` in `timeZone`. */
export function zonedTime(date: Date, timeZone: string): LocalTime {
  const out: Record<string, number> = {};
  for (const part of formatFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

const utcOf = (t: LocalTime) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);

/** The instant at which `timeZone` shows `local` (a time skipped by DST moves forward). */
export function fromZonedTime(local: LocalTime, timeZone: string): Date {
  const wanted = utcOf(local);
  const offsetAt = (t: number) => utcOf(zonedTime(new Date(t), timeZone)) - t;
  let t = wanted - offsetAt(wanted);
  t = wanted - offsetAt(t);
  return new Date(t);
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function zonedDay(date: Date, timeZone: string): string {
  const t = zonedTime(date, timeZone);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
/** 0 Sunday … 6 Saturday. */
const weekdayOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/** The weekday's place in its month: 1 to 4, or `last` for the fifth. */
export function weekdayOrdinal(day: number): 1 | 2 | 3 | 4 | 'last' {
  const n = Math.ceil(day / 7);
  return n >= 5 ? 'last' : (n as 1 | 2 | 3 | 4);
}

/** The weekday (0 Sunday … 6 Saturday) of `date` in `timeZone`. */
export function zonedWeekday(date: Date, timeZone: string): number {
  const t = zonedTime(date, timeZone);
  return weekdayOf(t.year, t.month, t.day);
}

// ---------------------------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------------------------

/**
 * A series' rule: occurrence `anchorIndex` starts at `anchorStartsAt`, the others follow from
 * it. An "all following" edit that moves the time re-anchors the series at the edited call.
 */
export type SeriesRule = {
  frequency: MeetingRepeatFrequency;
  timeZone: string;
  anchorStartsAt: Date;
  anchorIndex: number;
};

/**
 * The start of occurrence `index`: the anchor's local time of day, on the day the frequency
 * gives. Monthly on a date that a month lacks (the 31st) falls on its last day; monthly on the
 * fifth weekday falls on the month's last such weekday.
 */
export function occurrenceStart(rule: SeriesRule, index: number): Date {
  const a = zonedTime(rule.anchorStartsAt, rule.timeZone);
  const steps = index - rule.anchorIndex;
  let year: number;
  let month: number;
  let day: number;
  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const days = steps * (rule.frequency === 'weekly' ? 7 : 14);
    const d = new Date(Date.UTC(a.year, a.month - 1, a.day + days));
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  } else {
    const total = a.year * 12 + (a.month - 1) + steps;
    year = Math.floor(total / 12);
    month = (total % 12) + 1;
    const last = daysInMonth(year, month);
    if (rule.frequency === 'monthly_date') {
      day = Math.min(a.day, last);
    } else {
      const weekday = weekdayOf(a.year, a.month, a.day);
      const ordinal = weekdayOrdinal(a.day);
      const first = 1 + ((weekday - weekdayOf(year, month, 1) + 7) % 7);
      if (ordinal === 'last') {
        day = first + Math.floor((last - first) / 7) * 7;
      } else {
        day = first + (ordinal - 1) * 7;
      }
    }
  }
  return fromZonedTime(
    { year, month, day, hour: a.hour, minute: a.minute, second: a.second },
    rule.timeZone,
  );
}

/**
 * Whether occurrence `index` (starting at `start`) still belongs to a series that ends at
 * `until` (a local day, inclusive) or after `count` calls.
 */
export function withinSeriesEnd(
  end: { until: string | null; count: number | null; timeZone: string },
  index: number,
  start: Date,
): boolean {
  if (end.count !== null && index >= end.count) return false;
  if (end.until !== null && zonedDay(start, end.timeZone) > end.until) return false;
  return true;
}

/** The latest end date a series starting at `firstStart` may have (`YYYY-MM-DD`). */
export function latestSeriesEnd(firstStart: Date, timeZone: string): string {
  const t = zonedTime(firstStart, timeZone);
  const year = t.year + MEETING_SERIES_LIMITS.maxYearsAhead;
  const day = Math.min(t.day, daysInMonth(year, t.month));
  return `${year}-${String(t.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
