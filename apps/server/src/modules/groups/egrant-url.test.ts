import { describe, expect, it } from 'vitest';
import { normalizeEgrantUrl } from './egrant-url.js';

describe('normalizeEgrantUrl', () => {
  it.each([
    ['https://Firma.egrant.sk/', 'https://firma.egrant.sk'],
    ['https://firma.egrant.sk/app/login', 'https://firma.egrant.sk'],
    ['HTTPS://FIRMA.EGRANT.SK:443', 'https://firma.egrant.sk'],
    ['http://firma.egrant.sk:80/x?y=1#z', 'http://firma.egrant.sk'],
    ['https://a.egrant.sk.', 'https://a.egrant.sk'],
    ['  https://firma.egrant.sk:8443/ ', 'https://firma.egrant.sk:8443'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEgrantUrl(input)).toBe(expected);
  });

  it.each(['ftp://x', 'not a url', '', 'javascript:alert(1)'])('%s -> null', (input) => {
    expect(normalizeEgrantUrl(input)).toBeNull();
  });
});
