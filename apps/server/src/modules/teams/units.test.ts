import { describe, expect, it } from 'vitest';
import {
  CALENDAR_TOKEN,
  calendarToken,
  calendarTokenHash,
  isCalendarToken,
  newCalendarNonce,
} from './calendar-token.js';
import { parseTeamsLink } from './links.js';
import { inMeetingWindow, nextPollAt, plannedEnd } from './schedule.js';
import { transcriptText } from './transcripts.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const TID = '11111111-2222-4333-8444-555555555555';
const OID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseTeamsLink', () => {
  it('reads the tenant and organizer hints of a classic link', () => {
    const context = encodeURIComponent(JSON.stringify({ Tid: TID.toUpperCase(), Oid: OID }));
    const url = `https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=${context}`;
    expect(parseTeamsLink(`  ${url} `)).toEqual({
      kind: 'classic',
      joinWebUrl: url,
      tenantId: TID,
      organizerId: OID,
    });
  });

  it('accepts a classic link without (or with a broken) context', () => {
    const url =
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7Bnope';
    expect(parseTeamsLink(url)).toMatchObject({
      kind: 'classic',
      tenantId: null,
      organizerId: null,
    });
  });

  it('reads the meeting ID of the new short links (also on teams.cloud.microsoft)', () => {
    expect(parseTeamsLink('https://teams.microsoft.com/meet/38475610293?p=Xy7z')).toMatchObject({
      kind: 'meet',
      joinMeetingId: '38475610293',
    });
    expect(parseTeamsLink('https://teams.cloud.microsoft/meet/38475610293')).toMatchObject({
      kind: 'meet',
    });
  });

  it('personal Teams is outside; anything else is no Teams link', () => {
    expect(parseTeamsLink('https://teams.live.com/meet/9876543210')).toEqual({ kind: 'personal' });
    for (const bad of [
      'not a url',
      'http://teams.microsoft.com/meet/38475610293',
      'https://teams.microsoft.com.evil.example/meet/38475610293',
      'https://zoom.us/j/123456789',
      'https://teams.microsoft.com/l/chat/19:abc/0',
    ]) {
      expect(parseTeamsLink(bad), bad).toBeNull();
    }
  });
});

describe('transcript poll schedule', () => {
  const startsAt = new Date('2026-11-02T09:00:00Z');
  const meeting = { startsAt, durationMinutes: 60 };
  const end = plannedEnd(meeting).getTime();
  const at = (ms: number) => new Date(ms);

  it('first looks 10 minutes after the planned start', () => {
    expect(nextPollAt(at(startsAt.getTime() - 5 * HOUR), meeting)).toEqual(
      at(startsAt.getTime() + 10 * MIN),
    );
  });

  it('every 5 minutes until 3 hours after the planned end', () => {
    expect(nextPollAt(at(startsAt.getTime() + 10 * MIN), meeting)).toEqual(
      at(startsAt.getTime() + 15 * MIN),
    );
    expect(nextPollAt(at(end + 2 * HOUR), meeting)).toEqual(at(end + 2 * HOUR + 5 * MIN));
  });

  it('then hourly, and nothing after 3 days', () => {
    expect(nextPollAt(at(end + 3 * HOUR), meeting)).toEqual(at(end + 4 * HOUR));
    expect(nextPollAt(at(end + 71 * HOUR + 30 * MIN), meeting)).toEqual(at(end + 72 * HOUR));
    expect(nextPollAt(at(end + 72 * HOUR), meeting)).toBeNull();
  });

  it('keeps only transcripts from 1 hour before the start to 12 hours after the end', () => {
    expect(inMeetingWindow(at(startsAt.getTime() - 61 * MIN), meeting)).toBe(false);
    expect(inMeetingWindow(at(startsAt.getTime() - 59 * MIN), meeting)).toBe(true);
    expect(inMeetingWindow(at(end + 12 * HOUR), meeting)).toBe(true);
    // The next week's occurrence of a recurring series.
    expect(inMeetingWindow(at(startsAt.getTime() + 7 * 24 * HOUR), meeting)).toBe(false);
  });
});

describe('calendar token', () => {
  const secret = 'x'.repeat(32);

  it('is 128 bits of base64url, stable for the nonce, new with a new nonce', () => {
    const nonce = newCalendarNonce();
    const token = calendarToken(secret, 'item-1', nonce);
    expect(token).toMatch(CALENDAR_TOKEN);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    expect(calendarToken(secret, 'item-1', nonce)).toBe(token);
    expect(calendarToken(secret, 'item-1', newCalendarNonce())).not.toBe(token);
    expect(calendarToken(secret, 'item-2', nonce)).not.toBe(token);
    expect(calendarToken('y'.repeat(32), 'item-1', nonce)).not.toBe(token);
  });

  it('only the hash is a lookup key; a forged or other row token does not verify', () => {
    const nonce = newCalendarNonce();
    const token = calendarToken(secret, 'item-1', nonce);
    expect(calendarTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(calendarTokenHash(token)).not.toContain(token);
    const row = { itemId: 'item-1', calendarNonce: nonce };
    expect(isCalendarToken(secret, row, token)).toBe(true);
    expect(isCalendarToken(secret, { ...row, itemId: 'item-2' }, token)).toBe(false);
    expect(isCalendarToken(secret, { ...row, calendarNonce: null }, token)).toBe(false);
    const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(isCalendarToken(secret, row, forged)).toBe(false);
    expect(isCalendarToken(secret, row, 'short')).toBe(false);
  });
});

describe('transcriptText', () => {
  it('turns Teams WebVTT into "Name: text" lines', () => {
    const content = [
      'WEBVTT',
      '',
      '0f1c/12-0',
      '00:00:01.000 --> 00:00:04.000',
      '<v Jana Nováková>Dobrý deň, začnime.</v>',
      '',
      '00:00:05.000 --> 00:00:07.000',
      '<v Peter Malý>Súhlasím.</v>',
    ].join('\n');
    expect(transcriptText(content)).toBe(
      'Jana Nováková: Dobrý deň, začnime.\nPeter Malý: Súhlasím.',
    );
  });

  it('keeps a text without cues as it is', () => {
    expect(transcriptText('Plain text\r\nsecond line\n')).toBe('Plain text\nsecond line');
  });
});
