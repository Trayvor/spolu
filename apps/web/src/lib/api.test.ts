import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthResponseSchema } from '@ehub/shared';
import { ApiError, apiGet } from './api';

function mockFetch(status: number, body: string) {
  const fn = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('apiGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests /api<path> with credentials included', async () => {
    const fn = mockFetch(200, JSON.stringify({ status: 'ok', db: 'ok', version: 'abc' }));
    await apiGet('/health', HealthResponseSchema);
    expect(fn).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'include' }));
  });

  it('returns the parsed degraded body for a 503 health response', async () => {
    mockFetch(503, JSON.stringify({ status: 'degraded', db: 'down', version: 'abc' }));
    await expect(apiGet('/health', HealthResponseSchema)).resolves.toEqual({
      status: 'degraded',
      db: 'down',
      version: 'abc',
    });
  });

  it('rejects with ApiError on malformed JSON', async () => {
    mockFetch(200, '{not json');
    await expect(apiGet('/health', HealthResponseSchema)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects with ApiError on a non-JSON 5xx page', async () => {
    mockFetch(502, '<html>Bad gateway</html>');
    await expect(apiGet('/health', HealthResponseSchema)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects with ApiError when the body does not match the schema', async () => {
    mockFetch(200, JSON.stringify({ status: 'nope' }));
    await expect(apiGet('/health', HealthResponseSchema)).rejects.toBeInstanceOf(ApiError);
  });
});
