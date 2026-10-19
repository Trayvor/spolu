import { describe, expect, it } from 'vitest';
import { redactSearchQuery, requestLogSerializer } from './log-redact.js';

describe('redactSearchQuery', () => {
  it('drops the query string of the search routes only', () => {
    expect(redactSearchQuery('/api/search/messages?q=tajne')).toBe('/api/search/messages');
    expect(redactSearchQuery('/api/search?q=x&types=messages')).toBe('/api/search');
    expect(redactSearchQuery('/api/search')).toBe('/api/search');
    expect(redactSearchQuery('/api/groups?q=x')).toBe('/api/groups?q=x');
    expect(redactSearchQuery('/api/searchable?q=x')).toBe('/api/searchable?q=x');
  });

  it('the request serializer logs the redacted url', () => {
    expect(
      requestLogSerializer({
        method: 'GET',
        url: '/api/search?q=tajne',
        host: 'help.egrant.sk',
        ip: '10.0.0.1',
      }),
    ).toEqual({
      method: 'GET',
      url: '/api/search',
      host: 'help.egrant.sk',
      remoteAddress: '10.0.0.1',
    });
  });
});
