import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthResponseSchema } from '@spolu/shared';
import { i18n } from '@/i18n';
import { ApiError, apiGet, apiSend } from './api';

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
    expect(fn).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'include' }),
    );
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

describe('apiSend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ApiError carries the JSON error body and its code', async () => {
    mockFetch(409, JSON.stringify({ error: 'email_taken_admin' }));
    const err = await apiSend('POST', '/admins', { email: 'a@example.com' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({ error: 'email_taken_admin' });
    expect((err as ApiError).code).toBe('email_taken_admin');
  });

  it('apiSend posts JSON with Accept-Language', async () => {
    const fn = mockFetch(200, JSON.stringify({ ok: true }));
    await apiSend('POST', '/admins', { email: 'a@example.com' });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admins');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ email: 'a@example.com' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept-Language']).toBe(i18n.language);
  });
});
