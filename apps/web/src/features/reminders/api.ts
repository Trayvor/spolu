import { queryOptions } from '@tanstack/react-query';
import {
  ReminderSetDtoSchema,
  type ReminderPut,
  type ReminderSetDto,
  type ReminderSubjectKind,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/** The API route segment of each subject kind: `/api/<prefix>/:id/reminders`. */
export const REMINDER_PREFIX: Record<ReminderSubjectKind, string> = {
  knowledge: 'knowledge',
  task: 'tasks',
};

/** A subject's reminder set; the empty set when it has none. */
export const reminderSetQuery = (kind: ReminderSubjectKind, id: string) =>
  queryOptions({
    queryKey: ['reminders', kind, id],
    queryFn: () => apiGet(`/${REMINDER_PREFIX[kind]}/${enc(id)}/reminders`, ReminderSetDtoSchema),
  });

/** Saves a stand-alone subject's times (and recipients, when given); answers the saved set. */
export function putReminderSet(
  kind: ReminderSubjectKind,
  id: string,
  body: ReminderPut,
): Promise<ReminderSetDto> {
  return apiSend(
    'PUT',
    `/${REMINDER_PREFIX[kind]}/${enc(id)}/reminders`,
    body,
    ReminderSetDtoSchema,
  );
}

/** `prefix` is the subject's route, e.g. `/knowledge` or `/tasks`. */
export async function subscribeReminder(prefix: string, id: string): Promise<void> {
  await apiSend('POST', `${prefix}/${enc(id)}/reminders/subscription`);
}

export async function unsubscribeReminder(prefix: string, id: string): Promise<void> {
  await apiSend('DELETE', `${prefix}/${enc(id)}/reminders/subscription`);
}

/** The `.ics` download of a subject's upcoming times. */
export const reminderCalendarUrl = (prefix: string, id: string): string =>
  `/api${prefix}/${enc(id)}/reminders/calendar.ics`;
