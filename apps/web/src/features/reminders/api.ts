import { apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/** `prefix` is the subject's route, e.g. `/knowledge`; Phase 19 adds `/tasks`. */
export async function subscribeReminder(prefix: string, id: string): Promise<void> {
  await apiSend('POST', `${prefix}/${enc(id)}/reminders/subscription`);
}

export async function unsubscribeReminder(prefix: string, id: string): Promise<void> {
  await apiSend('DELETE', `${prefix}/${enc(id)}/reminders/subscription`);
}

/** The `.ics` download of a subject's upcoming times. */
export const reminderCalendarUrl = (prefix: string, id: string): string =>
  `/api${prefix}/${enc(id)}/reminders/calendar.ics`;
