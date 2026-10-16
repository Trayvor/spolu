import { i18n } from '@/i18n';

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

const timeOf = (d: Date, language: string) =>
  d.toLocaleTimeString(locale(language), { hour: '2-digit', minute: '2-digit', hour12: false });

/** Languages that write the day as an ordinal: "23. okt" (sk, cs, sl, hr, et), not "23 Oct". */
const ORDINAL_DOT = /^(sk|cs|sl|hr|et)\b/;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Thu 23 Oct" (sk: "št 23. okt"); weekday and date are formatted apart so every locale reads alike. */
function dayLabel(d: Date, language: string, withYear = false): string {
  const weekday = d.toLocaleDateString(locale(language), { weekday: 'short' });
  // The month alone is abbreviated by name in every locale; with the day, sk would give "10.".
  const { day, month } = leafParts(d.toISOString(), language);
  const date = `${day}${ORDINAL_DOT.test(language) ? '.' : ''} ${month}`;
  return `${weekday} ${date}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

/** "Today, 14:00", "Tomorrow, 09:00" or "Thu 23 Oct, 14:00" in the browser's time zone. */
export function formatReminderTime(iso: string, language: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  const time = timeOf(d, language);
  const t = (key: string, options?: Record<string, string>) =>
    i18n.t(`reminders.time.${key}`, { lng: language, ...options });
  if (days === 0) return t('today', { time });
  if (days === 1) return t('tomorrow', { time });
  const day = dayLabel(d, language);
  return t('dayTime', { day, time });
}

/** "Thu 23 Oct 2026, 14:00". */
export function formatReminderDate(iso: string, language: string): string {
  const d = new Date(iso);
  const day = dayLabel(d, language, true);
  return i18n.t('reminders.time.dayTime', { lng: language, day, time: timeOf(d, language) });
}

/** The day number and short month of the calendar leaf. */
export function leafParts(iso: string, language: string): { day: string; month: string } {
  const d = new Date(iso);
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString(locale(language), { month: 'short' }).replace(/\.$/, ''),
  };
}
