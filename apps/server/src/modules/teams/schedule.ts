// Teams T1: when the transcript poll looks at a meeting (spec "Transcripts, MVP: targeted
// polling"), and which transcripts belong to it.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The first look: this long after the planned start (a short call may already be over). */
export const FIRST_POLL_AFTER_START = 10 * MINUTE;
/** Every 5 minutes until 3 hours after the planned end, then hourly up to 3 days after it. */
export const FAST_POLL = 5 * MINUTE;
export const FAST_UNTIL_AFTER_END = 3 * HOUR;
export const SLOW_POLL = HOUR;
export const POLL_UNTIL_AFTER_END = 72 * HOUR;

export type MeetingTimes = { startsAt: Date; durationMinutes: number };

export const plannedEnd = (m: MeetingTimes) =>
  new Date(m.startsAt.getTime() + m.durationMinutes * MINUTE);

/**
 * When to look next after a look at `now` (or, before the meeting, the first look); null when
 * polling is over (3 days after the planned end).
 */
export function nextPollAt(now: Date, meeting: MeetingTimes): Date | null {
  const first = meeting.startsAt.getTime() + FIRST_POLL_AFTER_START;
  const end = plannedEnd(meeting).getTime();
  const t = now.getTime();
  if (t < first) return new Date(first);
  if (t + FAST_POLL <= end + FAST_UNTIL_AFTER_END) return new Date(t + FAST_POLL);
  if (t + SLOW_POLL <= end + POLL_UNTIL_AFTER_END) return new Date(t + SLOW_POLL);
  if (t < end + POLL_UNTIL_AFTER_END) return new Date(end + POLL_UNTIL_AFTER_END);
  return null;
}

/**
 * A transcript belongs to this record when it was made from 1 hour before the planned start
 * to 12 hours after the planned end. A recurring series shares one online meeting, so its
 * other occurrences' transcripts fall outside.
 */
export function inMeetingWindow(createdAt: Date, meeting: MeetingTimes): boolean {
  const t = createdAt.getTime();
  return t >= meeting.startsAt.getTime() - HOUR && t <= plannedEnd(meeting).getTime() + 12 * HOUR;
}
