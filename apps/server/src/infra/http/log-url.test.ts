import { describe, expect, it } from 'vitest';
import { logUrl } from './log-url.js';

describe('logUrl', () => {
  it('hides the feed token', () =>
    expect(logUrl('/api/public/calendar/' + 'a'.repeat(43) + '/help.ics')).toBe(
      '/api/public/calendar/:token/help.ics',
    ));
  it('hides a malformed token too', () =>
    expect(logUrl('/api/public/calendar/abc?x=1')).toBe('/api/public/calendar/:token?x=1'));
  it('leaves other URLs alone', () => expect(logUrl('/api/groups/g1')).toBe('/api/groups/g1'));
});
