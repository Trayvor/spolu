import type { UserLanguage } from '@spolu/shared';
import { serverTexts } from '../../infra/i18n/index.js';

/** Weeks, windows and dates of the weekly summary (spec 2026-10-19 §3), Europe/Bratislava. */

const TZ = 'Europe/Bratislava';
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of `at` in Bratislava. */
export function bratislavaDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);
}

/** `day` plus `days` calendar days (`YYYY-MM-DD`). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The ISO week of `now` in Bratislava, e.g. `2026-W43`. */
export function isoWeek(now: Date): string {
  const d = new Date(`${bratislavaDay(now)}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7; // Monday 1 … Sunday 7
  // The Thursday of the same ISO week decides its year.
  const thursday = new Date(d.getTime() + (4 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * The window of a new summary: from the previous row's end (any status), at most 14 days back,
 * 7 days when there is none; it ends now. A gap is covered, never lost silently.
 */
export function windowFor(previousEnd: Date | null, now: Date): { start: Date; end: Date } {
  const floor = now.getTime() - 14 * DAY_MS;
  const from =
    previousEnd && previousEnd.getTime() < now.getTime()
      ? previousEnd.getTime()
      : now.getTime() - 7 * DAY_MS;
  return { start: new Date(Math.max(from, floor)), end: now };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(lang: UserLanguage, withYear: boolean): Intl.DateTimeFormat {
  const key = `${lang}:${withYear}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(serverTexts(lang).intl, {
      timeZone: TZ,
      day: 'numeric',
      month: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** The window as text in `lang`: sk `13. 10. – 17. 10. 2026` (the year once when it is one). */
export function rangeText(lang: UserLanguage, start: Date, end: Date): string {
  const sameYear = bratislavaDay(start).slice(0, 4) === bratislavaDay(end).slice(0, 4);
  return `${formatter(lang, !sameYear).format(start)} – ${formatter(lang, true).format(end)}`;
}

/** A calendar day (`YYYY-MM-DD`) as text in `lang`, e.g. sk `20. 10. 2026`. */
export function dayText(lang: UserLanguage, day: string): string {
  // Noon UTC is the same calendar day in Bratislava.
  return formatter(lang, true).format(new Date(`${day}T12:00:00Z`));
}
