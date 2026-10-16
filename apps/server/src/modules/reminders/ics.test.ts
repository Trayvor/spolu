import { describe, expect, it } from 'vitest';
import { buildIcsText, icsFilename } from './ics.js';

const now = new Date('2026-10-16T08:30:05.123Z');
const event = (over: Partial<Parameters<typeof buildIcsText>[0]['events'][number]> = {}) => ({
  uid: 'reminder-t1@spolu',
  start: new Date('2026-10-25T09:00:00Z'),
  title: 'Submit the report',
  description: 'Body',
  url: 'https://spolu.example/groups/g/knowledge?k=i',
  ...over,
});

/** RFC 5545 3.1: remove every CRLF followed by one space. */
const unfold = (text: string) => text.replace(/\r\n /g, '');
/** The unfolded content lines, without the final empty string. */
const lines = (text: string) => unfold(text).split('\r\n').slice(0, -1);

describe('buildIcsText', () => {
  it('one VEVENT per event with stable UID', () => {
    const text = buildIcsText({
      now,
      events: [event(), event({ uid: 'reminder-t2@spolu', start: new Date('2026-11-01T10:00Z') })],
    });
    const all = lines(text);
    expect(all.slice(0, 5)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//eGrant//Spolu//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ]);
    expect(all.at(-1)).toBe('END:VCALENDAR');
    expect(all.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(all.filter((l) => l === 'END:VEVENT')).toHaveLength(2);
    expect(all.filter((l) => l.startsWith('UID:'))).toEqual([
      'UID:reminder-t1@spolu',
      'UID:reminder-t2@spolu',
    ]);
    // Same input, same output: re-importing updates the events instead of duplicating them.
    expect(buildIcsText({ now, events: [event()] })).toBe(buildIcsText({ now, events: [event()] }));
  });

  it('DTSTART is UTC', () => {
    const all = lines(buildIcsText({ now, events: [event()] }));
    expect(all).toContain('DTSTART:20261025T090000Z');
    expect(all).toContain('DTEND:20261025T091500Z');
    expect(all).toContain('DTSTAMP:20261016T083005Z');
    expect(all).toContain('SUMMARY:Submit the report');
    expect(all).toContain('URL:https://spolu.example/groups/g/knowledge?k=i');
  });

  it('has a display alarm at the start of each event', () => {
    const all = lines(buildIcsText({ now, events: [event()] }));
    const alarm = all.slice(all.indexOf('BEGIN:VALARM'), all.indexOf('END:VALARM') + 1);
    expect(alarm).toEqual([
      'BEGIN:VALARM',
      'TRIGGER:PT0M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Submit the report',
      'END:VALARM',
    ]);
    expect(all.indexOf('END:VALARM')).toBeLessThan(all.indexOf('END:VEVENT'));
  });

  it('escapes backslash, semicolon, comma and newline', () => {
    const all = lines(
      buildIcsText({
        now,
        events: [event({ title: 'a\\b;c,d', description: 'line 1\nline 2\r\nline 3' })],
      }),
    );
    expect(all).toContain('SUMMARY:a\\\\b\\;c\\,d');
    expect(all).toContain('DESCRIPTION:line 1\\nline 2\\nline 3');
  });

  it('every line ends in CRLF and is at most 75 octets', () => {
    const text = buildIcsText({
      now,
      events: [event({ title: 'x'.repeat(300), description: 'word, '.repeat(200) })],
    });
    expect(text.endsWith('\r\n')).toBe(true);
    // No bare LF or CR.
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const physical = text.split('\r\n').slice(0, -1);
    expect(physical.length).toBeGreaterThan(lines(text).length);
    for (const line of physical) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(lines(text)).toContain(`SUMMARY:${'x'.repeat(300)}`);
  });

  it('folding never splits a multi-byte character', () => {
    const title = 'č'.repeat(60) + '🙂';
    const text = buildIcsText({ now, events: [event({ title })] });
    expect(lines(text)).toContain(`SUMMARY:${title}`);
    const bytes = Buffer.from(text, 'utf8');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let start = 0;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
        const line = bytes.subarray(start, i);
        expect(line.length).toBeLessThanOrEqual(75);
        expect(() => decoder.decode(line)).not.toThrow();
        start = i + 2;
      }
    }
  });
});

describe('icsFilename', () => {
  it('filename slug', () => {
    expect(icsFilename('Podať správu 2026!')).toBe('podat-spravu-2026.ics');
    expect(icsFilename('  ---  ')).toBe('reminder.ics');
    expect(icsFilename('🙂')).toBe('reminder.ics');
    const long = icsFilename('a'.repeat(50) + ' ' + 'b'.repeat(50));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-z0-9-]+\.ics$/);
    expect(long).not.toMatch(/-\.ics$/);
  });
});
