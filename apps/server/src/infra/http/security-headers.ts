import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createRateLimiter } from './rate-limit.js';

/** Where browsers send CSP violation reports (`report-uri`, and `report-to csp`). */
export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * The enforced Content-Security-Policy of every answer (ADR 0044; the sources are listed in
 * docs/runbooks/deploy.md, "Security headers"). Written from the built web app:
 * - script: Vite's hashed module files, `registerSW.js`, the service worker, `push-sw.js` and
 *   `push-actions.js` (whose notification buttons call the API on this origin), all our own files; no inline script and no `eval` (zod runs `jitless`, `apps/web/src/lib/zod-jitless.ts`).
 * - style 'unsafe-inline': the bulk email preview is an `<iframe srcdoc>`, which inherits this
 *   policy, and email HTML is inline styles and a `<style>` block; ProseMirror pastes keep
 *   `style` attributes. React's `style` props go through the CSSOM, which CSP does not block.
 * - img/media `data:` and `blob:`: resized logos and image previews, recorded voice.
 * - connect: the API and Socket.IO on this origin; `ws(s)://` spelled out for older Safari,
 *   which does not count WebSockets as 'self'. AI, voice and email providers are called from
 *   the server, never from the browser.
 * - fonts, icons and the manifest are self-hosted; the email preview's images are on this origin.
 * - no framing by anyone, `<base>` and forms only to this origin, no plugins.
 */
export function contentSecurityPolicy(publicUrl: string): string {
  const url = new URL(publicUrl);
  const socket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' ${socket}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ');
}

/**
 * Sets the CSP (unless the route set its own, stricter one: the bulk email images), the
 * Reporting-Endpoints the policy's `report-to` names, and X-Frame-Options on every answer.
 * The app sets them, not Caddy, so the e2e run against the built server gets the same policy
 * as production.
 */
export function registerSecurityHeaders(app: FastifyInstance, publicUrl: string): void {
  const policy = contentSecurityPolicy(publicUrl);
  const endpoints = `csp="${new URL(CSP_REPORT_PATH, publicUrl).href}"`;
  app.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('content-security-policy', policy);
    }
    reply.header('reporting-endpoints', endpoints);
    reply.header('x-frame-options', 'DENY');
  });
}

const MAX_FIELD = 200;
const MAX_REPORTS = 10;

/** A URL for the log: no query or fragment, token-like path segments hidden, at most 200 chars. */
export function redactUrl(value: string): string {
  let out = value;
  try {
    const url = new URL(value);
    const path = url.pathname
      .split('/')
      .map((segment) => (segment.length >= 24 ? ':token' : segment))
      .join('/');
    out = `${url.origin === 'null' ? url.protocol : url.origin}${path}`;
  } catch {
    // 'inline', 'eval', 'data' and the like are not URLs: keep them as they are.
  }
  return out.slice(0, MAX_FIELD);
}

type Violation = {
  documentUrl?: string;
  directive?: string;
  blockedUrl?: string;
  sourceFile?: string;
  line?: number;
  disposition?: string;
};

const text = (value: unknown, redact: boolean): string | undefined =>
  typeof value === 'string' ? (redact ? redactUrl(value) : value.slice(0, MAX_FIELD)) : undefined;

function violation(fields: {
  document: unknown;
  directive: unknown;
  blocked: unknown;
  source: unknown;
  line: unknown;
  disposition: unknown;
}): Violation {
  const v: Violation = {
    documentUrl: text(fields.document, true),
    directive: text(fields.directive, false),
    blockedUrl: text(fields.blocked, true),
    sourceFile: text(fields.source, true),
    line: typeof fields.line === 'number' ? fields.line : undefined,
    disposition: text(fields.disposition, false),
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Violation;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** The violations of a legacy `report-uri` body or a Reporting API batch. */
function violations(body: unknown): Violation[] {
  if (Array.isArray(body)) {
    return body
      .map(record)
      .filter((report) => report.type === 'csp-violation')
      .slice(0, MAX_REPORTS)
      .map((report) => {
        const b = record(report.body);
        return violation({
          document: b.documentURL,
          directive: b.effectiveDirective,
          blocked: b.blockedURL,
          source: b.sourceFile,
          line: b.lineNumber,
          disposition: b.disposition,
        });
      });
  }
  const r = record(record(body)['csp-report']);
  if (Object.keys(r).length === 0) return [];
  return [
    violation({
      document: r['document-uri'],
      directive: r['effective-directive'] ?? r['violated-directive'],
      blocked: r['blocked-uri'],
      source: r['source-file'],
      line: r['line-number'],
      disposition: r.disposition,
    }),
  ];
}

/**
 * `POST /api/csp-report`: browsers' CSP violation reports, written to the server log as one
 * `csp violation` warning (URLs redacted). No session; 20 a minute per address (counted before
 * the body is read), bodies up to 8 kB. Exempt from the CSRF guard: a report changes nothing.
 */
export const cspReportRoutes: FastifyPluginAsync = async (app) => {
  const allow = createRateLimiter({ windowMs: 60_000, max: 20 });
  const parse = (
    _request: unknown,
    body: string,
    done: (err: Error | null, v?: unknown) => void,
  ) => {
    try {
      done(null, JSON.parse(body));
    } catch {
      done(Object.assign(new Error('invalid report'), { statusCode: 400 }));
    }
  };
  app.addContentTypeParser(
    ['application/csp-report', 'application/reports+json'],
    { parseAs: 'string', bodyLimit: 8 * 1024 },
    parse,
  );

  app.post(
    CSP_REPORT_PATH.replace(/^\/api/, ''),
    {
      bodyLimit: 8 * 1024,
      onRequest: async (request, reply) => {
        if (!allow(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      },
    },
    async (request, reply) => {
      const csp = violations(request.body);
      if (csp.length > 0) request.log.warn({ csp }, 'csp violation');
      return reply.code(204).send();
    },
  );
};
