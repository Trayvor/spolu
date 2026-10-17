/**
 * Durations of work (Phase 32, finance): whole minutes. A time entry holds 0..6000 (100 h);
 * above 12 h the time dialog asks "Correct?".
 */
export const MAX_ENTRY_MINUTES = 6000;
export const LONG_ENTRY_MINUTES = 12 * 60;

const HOURS = /^(\d+(?:[.,]\d+)?)\s*h$/;
const MINUTES = /^(\d+)\s*m(?:in)?$/;

/**
 * Reads a duration as people type it: `1:30`, `1,5`, `1.5` and a bare `2` (hours), `90m`,
 * `90 min`, `2h`, `2h 15m`, `1 h 30 min`. Fractions of an hour round to the minute. Null when
 * it is none of these, negative, or above 100 h.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;
  let minutes: number | null = null;
  const clock = /^(\d{1,3}):(\d{2})$/.exec(s);
  if (clock) {
    const m = Number(clock[2]);
    if (m < 60) minutes = Number(clock[1]) * 60 + m;
  } else if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    minutes = Math.round(Number(s.replace(',', '.')) * 60);
  } else {
    // `2h 15m`, `2h15m`, `1 h 30 min`, `2h`, `90m`: an hours part, a minutes part, or both.
    const both = /^(\d+(?:[.,]\d+)?\s*h)\s*(\d+\s*m(?:in)?)$/.exec(s);
    const h = both ? both[1]! : HOURS.test(s) ? s : null;
    const m = both ? both[2]! : MINUTES.test(s) ? s : null;
    if (h !== null || m !== null) {
      const hours = h ? Number(HOURS.exec(h)![1]!.replace(',', '.')) : 0;
      minutes = Math.round(hours * 60) + (m ? Number(MINUTES.exec(m)![1]) : 0);
    }
  }
  return minutes !== null && minutes <= MAX_ENTRY_MINUTES ? minutes : null;
}

/** `90` -> `1 h 30 min`, `60` -> `1 h`, `0` -> `0 min`; `units` from the UI language. */
export function formatDuration(
  minutes: number,
  units: { hours: string; minutes: string } = { hours: 'h', minutes: 'min' },
): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} ${units.minutes}`;
  return m === 0 ? `${h} ${units.hours}` : `${h} ${units.hours} ${m} ${units.minutes}`;
}
