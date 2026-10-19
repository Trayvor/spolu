/** Weeks and dates of the weekly summary screens, in Bratislava time like the server. */

const TZ = 'Europe/Bratislava';
const DAY_MS = 86_400_000;

const dayOf = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);

/** `YYYY-Www` of `at`. */
export function isoWeek(at: Date): string {
  const d = new Date(`${dayOf(at)}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  const thursday = new Date(d.getTime() + (4 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday (UTC noon) of an ISO week. */
export function weekMonday(week: string): Date {
  const [year, w] = week.split('-W').map(Number) as [number, number];
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const monday1 = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS);
  return new Date(monday1.getTime() + (w - 1) * 7 * DAY_MS);
}

export const shiftWeek = (week: string, delta: number): string =>
  isoWeek(new Date(weekMonday(week).getTime() + delta * 7 * DAY_MS));

export const weekNumber = (week: string): number => Number(week.split('-W')[1]);

const formats = new Map<string, Intl.DateTimeFormat>();
function format(lang: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}:${JSON.stringify(opts)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { timeZone: TZ, ...opts });
    formats.set(key, f);
  }
  return f;
}

/** `13. 10. – 17. 10. 2026` (the year once when both days are in it). */
export function rangeLabel(lang: string, start: Date, end: Date): string {
  const sameYear = dayOf(start).slice(0, 4) === dayOf(end).slice(0, 4);
  const short = { day: 'numeric', month: 'numeric' } as const;
  const long = { ...short, year: 'numeric' } as const;
  return `${format(lang, sameYear ? short : long).format(start)} – ${format(lang, long).format(end)}`;
}

/** Monday to Friday of a week, for the list's subtitle. */
export function weekRangeLabel(lang: string, week: string): string {
  const monday = weekMonday(week);
  return rangeLabel(lang, monday, new Date(monday.getTime() + 4 * DAY_MS));
}

export const dateLabel = (lang: string, iso: string): string =>
  format(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(iso));

export const dateTimeLabel = (lang: string, iso: string): string =>
  format(lang, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
