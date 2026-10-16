/**
 * Calendar export (RFC 5545): one VEVENT per reminder time, in UTC, with a display alarm at the
 * start. Our own ~80 lines instead of a dependency.
 */

export type IcsEvent = {
  /** Stable across exports (`reminder-<timeId>@spolu`), so importing again updates the event. */
  uid: string;
  start: Date;
  title: string;
  description: string;
  url: string;
};

const EVENT_MINUTES = 15;
const MAX_LINE_OCTETS = 75;

/** `YYYYMMDDTHHMMSSZ` (UTC, so no VTIMEZONE block is needed). */
function utc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** TEXT value escaping (RFC 5545 3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line at 75 octets (RFC 5545 3.1), never inside a UTF-8 character; each
 * continuation line starts with one space, which counts toward its 75.
 */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > MAX_LINE_OCTETS) {
      out.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n');
}

export function buildIcsText(input: { now: Date; events: IcsEvent[] }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//eGrant//Spolu//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const stamp = utc(input.now);
  for (const event of input.events) {
    const end = new Date(event.start.getTime() + EVENT_MINUTES * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(event.start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      // URI value: not TEXT, so not escaped.
      `URL:${event.url}`,
      'BEGIN:VALARM',
      'TRIGGER:PT0M',
      'ACTION:DISPLAY',
      // DESCRIPTION is required on a DISPLAY alarm.
      `DESCRIPTION:${escapeText(event.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const MAX_SLUG = 60;

/** `[a-z0-9-]` slug of the title, at most 60 characters, `reminder` when empty, plus `.ics`. */
export function icsFilename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, '');
  return `${slug || 'reminder'}.ics`;
}
