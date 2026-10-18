import type { PublicMeeting } from '@spolu/shared';

// Teams T1: the providers' public "add event" links. Each makes the viewer's own copy of the
// event (no updates, nothing goes to the organizer).

/** `YYYYMMDDTHHMMSSZ`, Google's `dates` format. */
const compactUtc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');

/** `body` is the description: the recording notice and the join link. */
export function outlookLink(meeting: PublicMeeting, body: string): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: meeting.title,
    startdt: new Date(meeting.startsAt).toISOString(),
    enddt: new Date(meeting.endsAt).toISOString(),
    body,
    location: meeting.joinUrl,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function googleLink(meeting: PublicMeeting, details: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${compactUtc(meeting.startsAt)}/${compactUtc(meeting.endsAt)}`,
    details,
    location: meeting.joinUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The `.ics` download, with the texts in the viewer's language. */
export const icsLink = (token: string, language: string) =>
  `/api/public/meetings/${encodeURIComponent(token)}/invite.ics?lang=${encodeURIComponent(language)}`;
