# 0044 An enforced Content-Security-Policy, set by the app, with a report endpoint

Date: 2026-10-18
Status: accepted

## Context
The security review of 2026-10-18 (finding M2) asked for a CSP. PR #132 put the full policy into `deploy/Caddyfile` as `Content-Security-Policy-Report-Only`, with only `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` enforced. Three gaps were left:
- The e2e run (`playwright.config.ts`) serves the built web app from the built server with no Caddy, so it never saw the policy: a change that the policy would block could pass CI and break production.
- The policy had no `report-uri` / `report-to`, so violations showed only in the console of whoever had it open.
- Caddy's `header` block is deferred (it has a `-Server` op) and overwrote whatever CSP the app set, for example the bulk email images' `default-src 'none'`.

## Decision
- **The app sets the policy** (`apps/server/src/infra/http/security-headers.ts`, `registerSecurityHeaders` in `app.ts`): an `onSend` hook gives every answer the enforced `Content-Security-Policy`, `Reporting-Endpoints: csp="<PUBLIC_URL>/api/csp-report"` and `X-Frame-Options: DENY`. A route that sets its own, stricter CSP keeps it. The Socket.IO source is derived from `PUBLIC_URL` (`wss://` for https, `ws://` for the e2e run on http). It replaces `registerNoFraming`, which covered only `/oauth/*`.
- **Caddy no longer overwrites it.** It sets `?Content-Security-Policy "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"`, a default written only on an answer with none (Caddy's own errors). The report-only header is gone.
- **The policy** (sources checked against the built `apps/web/dist`, the client code and the live headers of help.egrant.sk; see [deploy.md](../runbooks/deploy.md#security-headers)): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' wss://<domain>; worker-src 'self'; manifest-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri /api/csp-report; report-to csp`.
- **Styles keep `'unsafe-inline'`.** Hashes or nonces cannot cover the bulk email preview: it is an `<iframe srcdoc>` (it inherits the page's policy) holding email HTML, which is inline `style` attributes and a `<style>` block by necessity. Scripts get no `'unsafe-inline'` and no `'unsafe-eval'`; the build has no inline script.
- **zod runs `jitless` in the browser** (`apps/web/src/lib/zod-jitless.ts`, imported first by `main.tsx`): zod's object parser probes `new Function`, which the policy blocks; the probe is caught, but the browser would report a violation on every signed-in screen. The flag is set on zod's `globalThis.__zod_globalConfig`, so no zod code enters the initial JS (+0.05 kB).
- **`POST /api/csp-report`** takes `application/csp-report` (`report-uri`) and `application/reports+json` (the Reporting API) bodies up to 8 kB, 20 a minute per address (counted before the body is read), and writes one `csp violation` warning to the server log with the document, directive, blocked URL, source file and line. URLs lose their query and fragment, and path segments of 24 or more characters (tokens) become `:token`. No session, no database write; exempt from the CSRF guard.
- **e2e**: `e2e/csp.spec.ts` checks the header on the built server and opens the main screens, the realtime connection and the bulk email preview, failing on any CSP console message.

## Consequences
- Production and e2e have the same policy; a blocked script, style, image or connection shows up in CI.
- A future stricter policy (for example `style-src` without `'unsafe-inline'` outside the preview) can be tried as an extra `Content-Security-Policy-Report-Only` header next to the enforced one; its reports reach the same log.
- Any new third-party source (a CDN, an embedded video, an external image in emails, a browser-side API call) needs this policy changed in `security-headers.ts` and its test. The bulk email preview shows only images on our own origin today (uploaded images and the logo; the browser never sends email HTML), so external images in campaigns would need `img-src https:` or a proxy.
- In development the Vite server serves the page, so the policy applies only to API answers there; `pnpm test:e2e` and production are where it is enforced on pages.
