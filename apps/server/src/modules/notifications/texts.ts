import type { UserLanguage } from '@spolu/shared';
import { serverTexts, type ServerTexts } from '../../infra/i18n/index.js';

/** Server-side copy for push and email, in the user's language (`infra/i18n/<code>.ts`). */
export type Texts = ServerTexts['notifications'];

export function texts(lang: UserLanguage): Texts {
  return serverTexts(lang).notifications;
}

/** The wall clock of a reminder time in Bratislava, `HH:mm` (a task reminder on time). */
export function formatReminderClock(iso: string | undefined | null, lang: UserLanguage): string {
  const at = new Date(iso ?? NaN);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(serverTexts(lang).intl, {
    timeZone: 'Europe/Bratislava',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** A reminder time as the team reads it: Bratislava wall clock, e.g. "Sun 25 Oct, 10:00". */
export function formatReminderTime(iso: string | undefined | null, lang: UserLanguage): string {
  const at = new Date(iso ?? NaN);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(serverTexts(lang).intl, {
    timeZone: 'Europe/Bratislava',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}
