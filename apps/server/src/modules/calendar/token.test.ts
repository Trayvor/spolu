import { describe, expect, it } from 'vitest';
import { FEED_TOKEN, feedToken, feedTokenHash, isFeedToken, newFeedNonce } from './token.js';

describe('calendar feed token', () => {
  it('derives a 43-character token that changes with the nonce and the user', () => {
    const a = feedToken('secret', 'u1', 'n1');
    expect(a).toMatch(FEED_TOKEN);
    expect(feedToken('secret', 'u1', 'n1')).toBe(a);
    expect(feedToken('secret', 'u1', 'n2')).not.toBe(a);
    expect(feedToken('secret', 'u2', 'n1')).not.toBe(a);
    expect(feedToken('other', 'u1', 'n1')).not.toBe(a);
  });

  it('checks a token against its row', () => {
    const t = feedToken('secret', 'u1', 'n1');
    expect(isFeedToken('secret', { userId: 'u1', nonce: 'n1' }, t)).toBe(true);
    expect(isFeedToken('secret', { userId: 'u1', nonce: 'n2' }, t)).toBe(false);
    expect(isFeedToken('secret', { userId: 'u1', nonce: 'n1' }, t.slice(1))).toBe(false);
  });

  it('hashes as SHA-256 hex', () => expect(feedTokenHash('x')).toMatch(/^[0-9a-f]{64}$/));

  it('makes a fresh 16-byte nonce each time', () => {
    const a = newFeedNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newFeedNonce()).not.toBe(a);
  });
});
