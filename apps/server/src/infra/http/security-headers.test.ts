import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { registerStatic } from '../../static.js';
import { contentSecurityPolicy, redactUrl } from './security-headers.js';

describe('contentSecurityPolicy', () => {
  it('allows only this origin, with Socket.IO over wss for an https origin', () => {
    const policy = contentSecurityPolicy('https://help.example.com');
    expect(policy).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self'",
        "connect-src 'self' wss://help.example.com",
        "worker-src 'self'",
        "manifest-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        'report-uri /api/csp-report',
        'report-to csp',
      ].join('; '),
    );
  });

  it('uses ws:// for an http origin (the e2e run on localhost)', () => {
    expect(contentSecurityPolicy('http://localhost:3000')).toContain(
      "connect-src 'self' ws://localhost:3000;",
    );
  });

  it('never allows inline or eval scripts', () => {
    expect(contentSecurityPolicy('https://a.example')).not.toMatch(
      /script-src[^;]*'unsafe-(inline|eval)'/,
    );
  });
});

describe('redactUrl', () => {
  it('drops the query and fragment and hides token-like segments', () => {
    expect(redactUrl('https://h.example/groups/42/chat?x=secret#y')).toBe(
      'https://h.example/groups/42/chat',
    );
    expect(redactUrl('https://h.example/unsubscribe/u1.c1.abcdefghijklmnopqrstuvwxyz')).toBe(
      'https://h.example/unsubscribe/:token',
    );
    expect(redactUrl('inline')).toBe('inline');
    expect(redactUrl('x'.repeat(500))).toHaveLength(200);
  });
});

describe('security headers', () => {
  it('every answer carries the enforced CSP, Reporting-Endpoints and X-Frame-Options', async () => {
    const { app, close } = await buildTestApp();
    for (const url of ['/api/health', '/oauth/authorize?client_id=x', '/api/nope']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy']).toBe(
        contentSecurityPolicy('http://localhost:3000'),
      );
      expect(res.headers['content-security-policy-report-only']).toBeUndefined();
      expect(res.headers['reporting-endpoints']).toBe('csp="http://localhost:3000/api/csp-report"');
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
    await app.close();
    await close();
  });

  it('the served web app (index.html, the SPA fallback, the service worker) carries it too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spolu-csp-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(join(dir, 'sw.js'), 'self.x = 1');
    const { app, close } = await buildTestApp();
    await registerStatic(app, dir);
    for (const url of ['/', '/settings', '/sw.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-security-policy']).toContain("script-src 'self';");
    }
    await app.close();
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it("a route's own stricter CSP is kept", async () => {
    const { app, close } = await buildTestApp();
    app.get('/test-own-csp', async (_request, reply) =>
      reply.header('content-security-policy', "default-src 'none'").send('ok'),
    );
    const res = await app.inject({ method: 'GET', url: '/test-own-csp' });
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    await app.close();
    await close();
  });
});

describe('POST /api/csp-report', () => {
  const legacy = {
    'csp-report': {
      'document-uri': 'http://localhost:3000/unsubscribe/u1.c1.abcdefghijklmnopqrstuvwxyz?a=b',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js',
      'source-file': 'http://localhost:3000/assets/index.js',
      'line-number': 12,
      disposition: 'enforce',
    },
  };

  it('logs a legacy report-uri report (redacted) and answers 204', async () => {
    const lines: string[] = [];
    const { app, close } = await buildTestApp({
      logStream: { write: (line) => void lines.push(line) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report', 'sec-fetch-site': 'cross-site' },
      payload: JSON.stringify(legacy),
    });
    expect(res.statusCode).toBe(204);
    const line = lines.find((l) => l.includes('csp violation'));
    expect(line).toBeDefined();
    const entry = JSON.parse(line!) as { csp: Record<string, unknown>[] };
    expect(entry.csp).toEqual([
      {
        documentUrl: 'http://localhost:3000/unsubscribe/:token',
        directive: 'script-src-elem',
        blockedUrl: 'https://evil.example/x.js',
        sourceFile: 'http://localhost:3000/assets/index.js',
        line: 12,
        disposition: 'enforce',
      },
    ]);
    await app.close();
    await close();
  });

  it('logs Reporting API reports (application/reports+json), csp-violation ones only', async () => {
    const lines: string[] = [];
    const { app, close } = await buildTestApp({
      logStream: { write: (line) => void lines.push(line) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify([
        {
          type: 'csp-violation',
          url: 'http://localhost:3000/settings',
          body: {
            documentURL: 'http://localhost:3000/settings',
            effectiveDirective: 'img-src',
            blockedURL: 'https://img.example/a.png',
            disposition: 'enforce',
          },
        },
        { type: 'deprecation', body: { id: 'x' } },
      ]),
    });
    expect(res.statusCode).toBe(204);
    const entry = JSON.parse(lines.find((l) => l.includes('csp violation'))!) as {
      csp: Record<string, unknown>[];
    };
    expect(entry.csp).toEqual([
      {
        documentUrl: 'http://localhost:3000/settings',
        directive: 'img-src',
        blockedUrl: 'https://img.example/a.png',
        disposition: 'enforce',
      },
    ]);
    await app.close();
    await close();
  });

  it('refuses a body over 8 kB (413) and malformed JSON (400), logging nothing', async () => {
    const lines: string[] = [];
    const { app, close } = await buildTestApp({
      logStream: { write: (line) => void lines.push(line) },
    });
    const big = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(9000) } }),
    });
    expect(big.statusCode).toBe(413);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
    expect(lines.some((l) => l.includes('csp violation'))).toBe(false);
    await app.close();
    await close();
  });

  it('allows 20 reports a minute per address, then answers 429 without logging', async () => {
    const lines: string[] = [];
    const { app, close } = await buildTestApp({
      logStream: { write: (line) => void lines.push(line) },
    });
    const send = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/csp-report',
        headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': ip },
        payload: JSON.stringify(legacy),
      });
    for (let i = 0; i < 20; i++) expect((await send('203.0.113.1')).statusCode).toBe(204);
    expect((await send('203.0.113.1')).statusCode).toBe(429);
    expect((await send('203.0.113.2')).statusCode).toBe(204);
    expect(lines.filter((l) => l.includes('csp violation'))).toHaveLength(21);
    await app.close();
    await close();
  });
});
