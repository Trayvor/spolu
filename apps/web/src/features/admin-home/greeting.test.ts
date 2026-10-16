import { describe, expect, it } from 'vitest';
import { firstName, greetingKey } from './greeting';

describe('greetingKey (Bratislava time)', () => {
  it('03:59 evening, 04:00 morning, 12:00 afternoon, 18:00 evening (summer time, UTC+2)', () => {
    expect(greetingKey(new Date('2026-10-20T01:59:00Z'))).toBe('evening');
    expect(greetingKey(new Date('2026-10-20T02:00:00Z'))).toBe('morning');
    expect(greetingKey(new Date('2026-10-20T10:00:00Z'))).toBe('afternoon');
    expect(greetingKey(new Date('2026-10-20T16:00:00Z'))).toBe('evening');
  });

  it('after the DST change on 2026-10-25 (winter time, UTC+1)', () => {
    expect(greetingKey(new Date('2026-10-26T02:59:00Z'))).toBe('evening');
    expect(greetingKey(new Date('2026-10-26T03:00:00Z'))).toBe('morning');
    expect(greetingKey(new Date('2026-10-26T11:00:00Z'))).toBe('afternoon');
    expect(greetingKey(new Date('2026-10-26T17:00:00Z'))).toBe('evening');
  });

  it('firstName takes the first word', () => {
    expect(firstName('  Vlad Herasymenko ')).toBe('Vlad');
    expect(firstName('')).toBe('');
  });
});
