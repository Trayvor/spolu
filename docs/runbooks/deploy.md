# Deploy

How a new version of Spolu (shown to users as Help by eGrant) gets to an environment. The only environment now is `test`, at https://help.egrant.sk (first deployed 2026-10-15). Since 2026-10-18 it is deployed by hand from the orchestrator's Mac with `scripts/deploy-local.sh` after merging (GitHub Actions minutes exhausted; see [Local deploy](#local-deploy-2026-10-18-github-minutes-exhausted) and [ADR 0031](../decisions/0031-local-deploy-without-registry.md)); before that every push to `main` deployed it.

## How it works

All logic lives in `scripts/` ([ADR 0004](../decisions/0004-scripts-first-ci.md)); any CI system only prepares a runner, passes settings in as environment variables and calls:

1. `scripts/ci.sh` — every check: `pnpm install --frozen-lockfile`, shellcheck of `scripts/*.sh` and `deploy/backup/backup.sh`, `scripts/tests/*.test.sh`, the dev services from `docker-compose.dev.yml`, `pnpm lint`, `prettier --check .` and `pnpm typecheck` at the same time (`run_parallel` in `scripts/lib.sh`: each step's output is printed whole, in order, with its result and seconds; the script fails if any of them fails, after all three finish), `pnpm test`, Playwright Chromium + `pnpm test:e2e`, and `scripts/check-docs.sh "$CI_BASE_REF"` (default `origin/main`). `ci.sh --bench` (or `RUN_BENCH=1 scripts/ci.sh`) also runs the wall-clock benchmarks; CI never passes it ([performance.md](../architecture/performance.md#no-wall-clock-budgets-in-ci-tests)). No `.env` is needed. If the dev services were already running (your laptop) they are reused and left running; otherwise the script starts them and removes them on exit. `playwright install --with-deps` installs system packages, so the CI agent needs root or passwordless sudo (GitHub runners have it; a future Jenkins agent must too).
2. `scripts/build-image.sh <sha>` — `docker buildx build` for `linux/amd64,linux/arm64` with `APP_VERSION=<sha>`, pushed as `$IMAGE:<sha>`. The caller logs in to the registry first and provides a buildx builder with QEMU. Optional env: `EXTRA_TAG` also pushes `$IMAGE:$EXTRA_TAG` (the test deploy pushes `test`, so that tag always means "what test runs"); `BUILDX_CACHE=gha` uses the GitHub Actions layer cache (`mode=max`: build-stage layers are cached too, which speeds up the QEMU arm64 build; they hold no secrets since `.env` is in `.dockerignore`). `build-image.sh --load <sha>` builds only `BUILD_PLATFORM` (default `linux/amd64`) and loads it into the local Docker instead of pushing (no registry, no login); `BUILD_CONTEXT` (default the repository root) is the directory built.
3. `scripts/deploy.sh <env> <sha>` — over SSH:
   - checks `REDIRECT_DOMAINS` and writes `redirects.caddy` from it (`caddy_redirects` in `scripts/lib.sh`; a bad name stops the deploy before anything reaches the server);
   - uploads `deploy/docker-compose.yml`, `deploy/Caddyfile`, `redirects.caddy`, `deploy/backup/` and the env file to `/opt/spolu/<env>/` (the env file becomes `.env`, mode 600, written with umask 077; `DOMAIN`, `PUBLIC_URL` and `REDIRECT_DOMAINS` in it always come from the deploy variables, see `deploy_env`);
   - sets `IMAGE=` and `TAG=` in that `.env` to the deployed image, so a manual `docker compose up -d` on the server runs the same version;
   - logs in to the registry if `REGISTRY_TOKEN` is set (and logs out after the pull), then `docker compose pull` (with `IMAGE_PRELOADED=1`, set by `scripts/deploy-local.sh`: no login, the server checks that `$IMAGE:<sha>` is already loaded and pulls only the other services), `docker compose up -d --remove-orphans`, `caddy reload` inside the `caddy` container (`up` does not restart Caddy when only its mounted Caddyfile or `redirects.caddy` changed), `docker image prune -af --filter until=168h` (removes unused images older than 7 days, old releases included, so the small disk does not fill; last week's images stay for a quick rollback);
   - polls `https://$DOMAIN/api/health` every 5 s for up to 120 s until `version` equals `<sha>`. On timeout it prints the last response, `docker compose ps` and the last 50 app log lines (the health body is shown even for a 503), the rollback command `scripts/deploy.sh <env> <previous tag>` (read from the server's `.env` before the deploy), and exits 1.

| deploy.sh variable | required | meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | server hostname or IP |
| `DEPLOY_KNOWN_HOSTS` | yes | `known_hosts` line(s) of the server (`ssh-keyscan <host>`); pins its host key. Since 2026-10-18 `deploy.sh` refuses to run without it (`deploy_ssh` in `scripts/lib.sh`, `StrictHostKeyChecking=yes`, never `accept-new`): a first connection to a man in the middle would hand it the env file with every secret |
| `DEPLOY_USER` | yes | SSH user, `deploy` (created by [server-setup.md](server-setup.md)) |
| `DEPLOY_SSH_KEY` | yes | path to that user's private key |
| `DEPLOY_ENV_FILE` | yes | path to the env file (template `deploy/test.env.example`) |
| `IMAGE` | yes | image repository, lowercase, e.g. `ghcr.io/trayvor/spolu` |
| `DOMAIN` | yes | public domain, for the health check; also `DOMAIN=` and `PUBLIC_URL=https://<domain>` of the server's `.env` |
| `REDIRECT_DOMAINS` | no | space-separated old domains, e.g. `spolu.egrant.sk`; each gets its own certificate and a permanent (301) redirect to `https://$DOMAIN` with the same path and query. Lowercase host names only, never `DOMAIN` itself. Unset or empty: no redirect, no extra certificate |
| `DEPLOY_PORT` | no | SSH port, default 22 |
| `REGISTRY_USER`, `REGISTRY_TOKEN` | no | registry login on the server for a private image |
| `IMAGE_PRELOADED` | no | `1`: the image is already on the server (`docker load`); no login, no pull of the app image |

Secrets are never printed. The SSH settings use a per-run `known_hosts` file, never the runner's `~/.ssh`.

## Security headers

`deploy/Caddyfile` and the app set them on every answer of `{$DOMAIN}` (security review 2026-10-18, finding M2; tests: `scripts/tests/caddy-headers.test.sh`, which with Docker runs `caddy adapt` on the real file, and `apps/server/src/infra/http/security-headers.test.ts`):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (Caddy; no `preload`: hard to undo). A browser that saw it keeps using HTTPS for the domain and its subdomains for a year. For a prod-like run on `localhost` (below) that only means the browser insists on `https://localhost`, which Caddy serves anyway.
- `X-Frame-Options: DENY` (Caddy and the app): no page can be framed by another site (clickjacking).
- An **enforced** `Content-Security-Policy`, set by the app (`apps/server/src/infra/http/security-headers.ts`, [ADR 0044](../decisions/0044-enforced-csp-set-by-the-app.md)), so the e2e run against the built server has it too. Caddy only adds `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` as a default (`?`) on an answer without one (its own errors). A route may set a stricter one (the bulk email images: `default-src 'none'`). The policy and why each source is there:
  - `default-src 'self'`; `script-src 'self'`: Vite's hashed module files, `registerSW.js`, `sw.js`, `workbox-*.js` and `push-sw.js` (imported by the worker), all our own; the build has no inline script and no `eval` (zod runs `jitless` in the browser, `apps/web/src/lib/zod-jitless.ts`; the Socket.IO client's `Function('return this')` fallback is never reached in a browser).
  - `style-src 'self' 'unsafe-inline'`: the bulk email preview is an `<iframe srcdoc>`, which inherits the page's policy, and email HTML is inline styles and a `<style>` block; ProseMirror keeps `style` attributes of pasted HTML. React `style` props use the CSSOM, which CSP does not block. Hashes or nonces cannot cover email HTML.
  - `img-src 'self' data: blob:`: logos and avatars (`/api/…`), uploaded file previews, the email preview's images (uploaded images under `/api/bulk-email/images/` and `/brand/egrant-logo-email.png`, both on `PUBLIC_URL`; campaigns cannot hold external images, the browser sends only the block tree), and `data:`/`blob:` previews of a picked logo or a resized image.
  - `media-src 'self' blob:`: meeting recordings and voice messages from `/api/files/…`.
  - `font-src 'self'`: the self-hosted Saans fonts (`/fonts`); no Google Fonts.
  - `connect-src 'self' wss://{$DOMAIN}`: the API and Socket.IO (`ws://` for an http `PUBLIC_URL`); spelled out for older Safari. AI, voice (OpenAI, ElevenLabs), email (Elastic) and Teams (Graph) are called from the server, never the browser. Web push subscribes through the browser's push service, which CSP does not cover.
  - `worker-src 'self'`, `manifest-src 'self'`: the service worker and `manifest.webmanifest`.
  - `frame-src 'self'`: the `srcdoc` preview needs none; nothing else is framed.
  - `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`. Forms submit through `fetch`; the MCP consent page leaves for Claude's redirect URI with `location.assign` (a navigation, which CSP does not limit). Links out (claude.ai, Outlook and Google calendar, Teams join links, egrant.sk) are plain navigations too.
  - `report-uri /api/csp-report; report-to csp` with `Reporting-Endpoints: csp="<PUBLIC_URL>/api/csp-report"`. The endpoint writes one `csp violation` warning per report to the app log (URLs without query and with tokens hidden; 20 a minute per address, 8 kB at most). Watch it after a deploy: `docker compose logs app | grep 'csp violation'`.
  
  **Adding a source** (a CDN, an embed, a browser-side API): change `contentSecurityPolicy` and its test, and check `e2e/csp.spec.ts`, which opens the main screens and the email preview on the built server and fails on any CSP console message. **A stricter policy** can be tried as an extra `Content-Security-Policy-Report-Only` header next to the enforced one; its reports reach the same log.
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self), payment=(), usb=()` (Caddy; voice input needs the microphone).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, no `Server` header (Caddy).

`Cross-Origin-Opener-Policy` is not set on purpose: Claude's connector flow opens the consent page from claude.ai, and `same-origin` would cut that window from its opener.

## Image digests

Every image is pinned by digest ([ADR 0037](../decisions/0037-supply-chain-policy.md)): the `Dockerfile` bases (`NODE_IMAGE`, `RUNTIME_IMAGE`, `FFMPEG_IMAGE` = `mwader/static-ffmpeg`) and the `postgres` and `caddy` images of `deploy/docker-compose.yml`. A tag can be pushed again; a digest always means the same bytes, so `docker compose pull` on a deploy fetches only what the repository names. The tag in front of the digest (`postgres:17.11@sha256:…`) is only for people.

To bump one (for example monthly, or for a security release), on a branch:

```bash
docker buildx imagetools inspect postgres:17       # or caddy:2, node:24-bookworm-slim, debian:bookworm-slim, mwader/static-ffmpeg:<version>
# take the version (e.g. PG_VERSION in --format '{{json .Image}}') and the top "Digest:" line
# (the multi-platform index, which covers arm64 and amd64), then write <image>:<version>@<digest>
```

Keep `NODE_IMAGE` and `RUNTIME_IMAGE` on the same Debian release (bookworm today: the node binary is copied from one into the other). A new PostgreSQL major needs a dump and restore, never only a new tag. ffmpeg is 8.1.2 (pinned by digest, [ADR 0041](../decisions/0041-ffmpeg-hardened-for-untrusted-uploads.md)); before a further bump, run the hardened arguments in the new image (a transcode, a split, and an ffconcat file that must be refused) and the media test with `FFMPEG_PATH` pointing at it. Run `bash scripts/tests/caddy-redirects.test.sh` and `caddy-headers.test.sh` after a Caddy bump (they validate the Caddyfile with the image named in compose).

## Supply-chain policy (pnpm)

`pnpm-workspace.yaml` holds it ([ADR 0037](../decisions/0037-supply-chain-policy.md)); it applies to every install, the frozen ones in `ci.sh` and the `Dockerfile` included, because pnpm checks the lockfile against it:

- `minimumReleaseAge: 10080` — a version must be 7 days old. A lockfile entry younger than that fails the install (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). For an urgent security patch add `name@version` to `minimumReleaseAgeExclude` with a comment and the date it can go. The list there today grandfathers the lockfile of 2026-10-18 and can be deleted on or after 2026-10-22.
- `trustPolicy: no-downgrade` — a version published with weaker trust evidence than an earlier one (the pattern of a stolen npm token) fails the install; reviewed exceptions go into `trustPolicyExclude` as exact versions.
- `blockExoticSubdeps: true` — transitive dependencies come only from the registry, never git or tarballs.
- `strictDepBuilds: true` with `allowBuilds` — only esbuild may run an install script; any other one fails the install.
- The `Dockerfile` installs pnpm with `npm install -g --ignore-scripts`, builds from the frozen lockfile, and makes the production `node_modules` with `pnpm deploy --prod --frozen-lockfile --ignore-scripts`.

Review lockfile diffs in pull requests: a new transitive package is a review item.

## MCP server

`/mcp` (the AI assistants' endpoint, [integrations/mcp.md](../integrations/mcp.md)) is served by the app like every path: the Caddyfile's single `reverse_proxy app:3000` covers it, so no Caddy change and no new environment variable is needed. Its rate limits live in memory, like the others ([ADR 0005](../decisions/0005-single-process-deployment.md)). Migration 0046 adds its two tables. OAuth for Claude's custom connectors ([ADR 0034](../decisions/0034-mcp-oauth-authorization-server.md)) adds `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` and `/oauth/*`; the same `reverse_proxy` covers them (checked 2026-10-18), and the issuer is `PUBLIC_URL`'s origin, so `PUBLIC_URL` must be the public `https://` address. Migration 0046 adds its four tables. Nothing else to configure; the consent token is signed with `APP_SECRET`.

## Microsoft Teams

Teams (T1, [integrations/teams.md](../integrations/teams.md)) is off until the env file has `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID` and one credential: `TEAMS_CLIENT_SECRET`, or `TEAMS_CERT_PATH` + `TEAMS_CERT_THUMBPRINT`. A partial set stops the app at start with the missing names (never the values). With the certificate, put the private key file in `/opt/spolu/<env>/secrets/teams.pem` (owner `deploy`, mode 600), uncomment the `./secrets:/run/secrets/spolu:ro` volume in `docker-compose.yml` and set `TEAMS_CERT_PATH=/run/secrets/spolu/teams.pem`. The app calls `login.microsoftonline.com` and `graph.microsoft.com` outbound (HTTPS); nothing comes in from Microsoft in T1 (no webhook), so no Caddy change. The public page `/m/<token>` and its `/api/public/meetings/*` routes go through the same `reverse_proxy`. Migration 0048 adds `teams_organizers`, `teams_meeting_links` (with a partial unique index on `online_meeting_id`) and `knowledge_meetings.transcript_admins_only`. The certificate's key must be an unencrypted RSA key (PKCS#8 or PKCS#1 PEM); a missing, encrypted or non-RSA key stops the app at start with a `TEAMS_CERT_PATH` message. **Changing `APP_SECRET` invalidates every public meeting link** (`/m/<token>` is derived from it): the old links answer 404, and an admin copies each meeting's new link from its Teams block (Copy invitation link) and sends it again; the Outlook invitations already sent keep the old link. To switch Teams off, empty the variables and restart: every Teams route answers 404 and the poll job is not scheduled; the stored links stay.

## Superadmin settings

The env file sets `SUPERADMIN_EMAIL` and optionally `SUPERADMIN_NAME` (default: the part of the email before `@`). On every start the app makes sure that user exists, is a superadmin and is active. It never promotes an existing admin or client with that email: it logs `SUPERADMIN_EMAIL ... was not promoted` and starts without changing that account. To make such an account the superadmin, set `role = 'superadmin'` by hand in the database. Changing `SUPERADMIN_EMAIL` **adds** a second superadmin and keeps the old one; the old superadmin is not demoted. To retire the old account, remove it by hand in the database (`update "user" set role = 'admin'` first, then remove it on the Admins page). Both accounts log in by email code, so `MAIL_FROM` must be verified in Elastic Email before the first login on a server.

## Generate VAPID keys once per environment

Browser push needs a VAPID key pair ([ADR 0013](../decisions/0013-web-push.md)). On your laptop run `pnpm --filter @spolu/server vapid:generate`, put `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into the environment's env file together with `VAPID_SUBJECT` (`mailto:` or `https:` contact), and deploy. Generate once and keep the keys: changing them invalidates every subscription, and users must enable push again. Leaving all three unset turns push off.

## Phase 18: the group managers seed

Migration 0011 (`group_managers`) creates the table, adds `group_notification_settings.origin` (existing rows become `user`) and then seeds managers once from production data: every active admin or superadmin becomes a manager of each group where they are assigned to an open task (not in Completed), or wrote a not-deleted message in the group chat or a task chat in the last 60 days before the deploy. It inserts only into `group_managers` (on conflict do nothing) and does **not** touch anyone's notification mode, so nobody's bells change on deploy. Admins adjust the result themselves on the Groups page. To see what it did after the deploy:

```sql
select g.name, u.name from group_managers gm
  join groups g on g.id = gm.group_id join "user" u on u.id = gm.user_id
 order by g.name, u.name;
```

## Phase 6 check on real devices

To be walked by the owner and one test client on the test server (https://help.egrant.sk) with the VAPID keys set (see above); not yet recorded as done. Each item is "Done when" of Phase 6 ([spec](../superpowers/specs/2026-10-16-phase-6-notifications-design.md#done-when)).

- **Desktop browser** (Chrome or Edge, then Firefox):
  - [ ] Sign in as the client: the "Turn on notifications on this device" banner appears; **Turn on** asks for permission; `/settings` then says "This device: on".
  - [ ] The admin sends a message in the client's group: a notification appears with the group name and "Name: text"; clicking it opens the message.
  - [ ] Set the bell to Mentions and replies: a plain message brings nothing, an @mention does. Off: nothing.
  - [ ] The admin's groups page: the bell on a row and the "All groups:" control change the modes ("Mixed" when they differ).
  - [ ] Move a task the client created or is assigned to: its creator and assignees get "Moved to …", the mover nothing. A task due in 1-3 days reminds its assignees at 09:00; an urgent one at 08:00, 11:00, 14:00, 17:00 and 20:00.
  - [ ] Turn on Email in `/settings`, leave the chat, have the admin send 3 messages: about 10 minutes later one email "3 new messages in <group>" arrives (none if the messages were read first).
  - [ ] `/settings`: change the name (Save, "Saved"); change the email (code to the new address, notice to the old one); a wrong code says so and keeps the step.
  - [ ] Block notifications in the site settings and reload: `/settings` says "blocked in the browser settings" with the unblock line, and no banner shows.
- **Android phone** (Chrome):
  - [ ] Right after sign-in the install card appears; **Install** opens the browser's install dialog (or the card shows the menu steps).
  - [ ] Open the installed app: the enable banner appears; **Turn on** grants; a message from the admin arrives as a notification with the app closed, and tapping it opens the message.
  - [ ] "Not now" on either card hides it; it returns after 6 hours.
- **iPhone** (iOS 16.4 or newer, Safari):
  - [ ] In Safari, the dark install card appears ("Important: install the Help app to get notifications …") with the Share → Add to Home Screen → open from the icon steps; `/settings` shows the same hint instead of the device line.
  - [ ] Add to Home Screen, open Help from the icon, sign in: the enable banner appears; **Turn on** grants; a message arrives as a notification and opens the message.
  - [ ] On an iPhone below 16.4 (if one is at hand): the card says iOS is too old and email was turned on; `/settings` shows Email on.

## GitHub Actions

The workflows in `.github/workflows/` only check out, set up tools, pass settings and call the scripts. Actions are pinned to major versions, except `crazy-max/ghaction-github-runtime` (third party, exposes the cache token to `docker buildx`), which is pinned to a commit SHA.

Since 2026-10-18 both workflows run **only by hand** (`workflow_dispatch`): the Actions minutes are exhausted. Pull requests are checked by a local `scripts/ci.sh`, and test is deployed with [Local deploy](#local-deploy-2026-10-18-github-minutes-exhausted). The files stay for later; their header comment says what to put back.

- `ci.yml` — by hand (before 2026-10-18: on every pull request): Node 24, pnpm (version from `packageManager`), then `scripts/ci.sh` with `CI_BASE_REF=origin/<base branch>`.
- `deploy-test.yml` — by hand only (before 2026-10-18 also on every push to `main` that changed more than docs) (**Actions → Deploy test → Run workflow**, optional `ref` = branch, tag or SHA, so a branch can be tried on test before merge). Job `ci` runs `scripts/ci.sh` on that ref; when it fails, it uploads `test-results/` (Playwright traces and page snapshots) as the `e2e-test-results` artifact for 7 days; job `deploy` (needs `ci`, GitHub environment `test`) sets up QEMU and buildx, logs in to `ghcr.io` with `GITHUB_TOKEN`, runs `scripts/build-image.sh <sha>` (`EXTRA_TAG=test`, `BUILDX_CACHE=gha`), writes the secrets to files with umask 077 and runs `scripts/deploy.sh test <sha>`. `<sha>` is `git rev-parse HEAD` of the `ci` job's checkout, passed as a job output; `deploy` checks out exactly that SHA, so the deployed commit is the tested one, also for a manual run with a `ref`. Concurrency group `deploy-test`: deploys queue, never cancel each other.

Settings of the GitHub environment `test` (**Settings → Environments → test**):

| kind | name | value |
|---|---|---|
| secret | `TEST_SSH_KEY` | private key of the `deploy` user (from [server-setup.md](server-setup.md)) |
| secret | `TEST_ENV_FILE` | full content of the server env file, filled from `deploy/test.env.example` |
| variable | `DEPLOY_HOST` | server hostname or IP |
| variable | `DEPLOY_USER` | `deploy` |
| variable | `DOMAIN` | public domain (`help.egrant.sk`); it overrides `DOMAIN` and `PUBLIC_URL` of the env file |
| variable | `REDIRECT_DOMAINS` | optional, old domains redirected to `DOMAIN` (`spolu.egrant.sk` after the move); see "Moving to a new domain" |
| variable | `MAIL_FROM_NAME` | optional, the senders' display name (`Help by eGrant`); it replaces the name in `MAIL_FROM` and `MAIL_FROM_BULK` of the env file |
| variable | `IMAGE` | `ghcr.io/trayvor/spolu` (lowercase) |
| variable | `DEPLOY_KNOWN_HOSTS` | required, output of `ssh-keyscan <host>`; the deploy refuses to run without it |

The image is private (private repository), so the server logs in to GHCR with the job's `GITHUB_TOKEN` for the pull and logs out right after. Moving to another CI (GitLab + Jenkins) means writing these few steps again with the same variables; the scripts stay.

## Moving to a new domain

The senders' display name can also come from a variable: with `MAIL_FROM_NAME` set (for example `Help by eGrant`), `deploy_env` rewrites `MAIL_FROM=` and `MAIL_FROM_BULK=` of `TEST_ENV_FILE` to `<name> <their address>`, so renaming the sender needs no secret edit.

The product became **Help by eGrant** on 2026-10-16 and moved from `spolu.egrant.sk` to `help.egrant.sk`; the old domain now answers `301` to the new one. Keep the old name's DNS pointing at the server too, or its redirect cannot work. The steps below are how that move was done; repeat them for any later domain.

**How the redirect works.** `deploy/Caddyfile` ends with `import redirects.caddy`. `scripts/deploy.sh` writes that file from `REDIRECT_DOMAINS` on every deploy: unset or empty, it holds only comments, so Caddy starts cleanly and asks for no extra certificate; otherwise one site block lists the old domains, Caddy gets a certificate for each and answers `redir https://{$DOMAIN}{uri} permanent` (301, path and query kept). `REDIRECT_DOMAINS=` is also written into the server's `.env` as a record. Tests: `scripts/tests/deploy-env.test.sh` and `scripts/tests/caddy-redirects.test.sh` (with Docker it runs `caddy validate` on the real Caddyfile with and without old domains).

**Steps.**

1. In the GitHub environment `test`, set the variable `DOMAIN=help.egrant.sk` and add `REDIRECT_DOMAINS=spolu.egrant.sk`.
2. In the secret `TEST_ENV_FILE`, change the From display name: `MAIL_FROM=Help by eGrant <…>` (and `MAIL_FROM_BULK` if set). `PUBLIC_URL` there is overridden anyway.
3. Deploy with `scripts/deploy-local.sh test` (or, when Actions minutes are back, **Actions → Deploy test → Run workflow**). The health check now polls `https://help.egrant.sk/api/health`.
4. Check: `curl -sI https://spolu.egrant.sk/groups?x=1` answers `301` with `location: https://help.egrant.sk/groups?x=1`; the app opens on `https://help.egrant.sk`; a login email links to `help.egrant.sk`.
5. Tell eGrant's developers the new intake URL `https://help.egrant.sk/api/tickets/intake` ([integrations/egrant-ticket-intake.md](../integrations/egrant-ticket-intake.md)). The old URL keeps answering through the redirect only for clients that follow redirects and resend the POST body (a 301 makes many HTTP clients switch to GET), so the switch must be made.

**What users notice.**

- Everyone signs in again on the new domain: the session cookie belongs to the old domain and is not sent to the new one.
- Push notifications must be turned on again on every device: a push subscription belongs to the site's origin. The app's "Turn on notifications" card asks again on the new domain; email notifications are not affected.
- An installed app (PWA) still opens the old address and is redirected to the browser. Remove it and install again from `https://help.egrant.sk`.
- Old links (in earlier emails, bookmarks, unsubscribe links) keep working through the redirect for as long as `REDIRECT_DOMAINS` keeps the old domain.
- Emails, the page title, the header and the installed app's name now say Help / Help by eGrant.

Keep `REDIRECT_DOMAINS` for at least a few months; removing it later (empty variable, deploy) makes the old domain stop answering.

## Local deploy (2026-10-18, GitHub minutes exhausted)

The GitHub Actions minutes are exhausted, so the test environment is deployed from the orchestrator's Mac (Apple M3, Docker Desktop) after a green local `scripts/ci.sh`, with no GitHub Actions and no registry ([ADR 0031](../decisions/0031-local-deploy-without-registry.md)). Jenkins can later call the same script.

```bash
scripts/deploy-local.sh                  # env test, sha = HEAD
scripts/deploy-local.sh test <sha>       # another commit (e.g. a rollback)
scripts/deploy-local.sh --force-ref      # allow a dirty tree / a commit not on origin/main
```

What `scripts/deploy-local.sh [--force-ref] [<env> [<sha>]]` does:

1. Refuses a working tree with uncommitted changes and a commit that is not on `origin/main` (it fetches `origin main` first). `--force-ref` lifts both, e.g. to try a branch on test. The image is always built from the commit (`git archive <sha>`), never from the files on disk.
2. Reads the config file `$SPOLU_DEPLOY_CONFIG`, default `~/.config/spolu/<env>.deploy` (parsed, never run as shell code; see below). It, the SSH key and the env file must be private to you (no group or other permission bits, `chmod 600`), otherwise it stops. Variables already set in your shell are ignored for these keys (a stray `REGISTRY_TOKEN` too). Nothing secret is printed.
3. If the server already has `$IMAGE:<sha>` (a redeploy, or a rollback within the 7 days the server keeps images) it skips the build. Otherwise it builds only the server's platform with `scripts/build-image.sh --load` (tags `$IMAGE:<sha>` and `$IMAGE:<env>`): `DEPLOY_PLATFORM` from the config, default `linux/arm64` (the test server is aarch64, and the M3 builds arm64 natively); `linux/amd64` builds through QEMU and is slower; `auto` asks the server's `uname -m` (`aarch64` → `linux/arm64`, `x86_64` → `linux/amd64`).
4. Streams the image: `docker save $IMAGE:<sha> $IMAGE:<env> | gzip | ssh … 'gunzip | docker load'` (about 135 MB).
5. Runs `scripts/deploy.sh <env> <sha>` with `IMAGE_PRELOADED=1` and `DEPLOY_ENV_FILE=$ENV_FILE`: same upload, `.env`, Caddy reload and health check as above, but no registry login and no pull of the app image.

Tests: `scripts/tests/deploy-local.test.sh` (stubbed docker, ssh, scp and curl; a throwaway git repository).

### The config file

Create it once, outside the repository (the directory `chmod 700`, every file in it `chmod 600`):

```bash
mkdir -p ~/.config/spolu && chmod 700 ~/.config/spolu
touch ~/.config/spolu/test.deploy && chmod 600 ~/.config/spolu/test.deploy
```

The file is **parsed, never run** (`load_deploy_config` in `scripts/lib.sh`): one `KEY=value` per line; blank lines and lines starting with `#` are skipped; the value is everything after `=` (spaces need no quotes; one pair of surrounding `'…'` or `"…"` is removed); a leading `~/` is expanded; no comment after a value; an unknown key or a malformed line stops the script. Template, with every key:

```bash
# ~/.config/spolu/test.deploy (chmod 600), read by scripts/deploy-local.sh test
# GitHub variable DEPLOY_HOST: server hostname or IP
DEPLOY_HOST=<server hostname or IP>
# GitHub variable DEPLOY_USER
DEPLOY_USER=deploy
# optional, default 22
DEPLOY_PORT=22
# ssh-keyscan lines of the server (see below); or one inline line in DEPLOY_KNOWN_HOSTS=
DEPLOY_KNOWN_HOSTS_FILE=~/.config/spolu/test.known_hosts
# path; content = the GitHub secret TEST_SSH_KEY (the deploy user's private key)
DEPLOY_SSH_KEY=~/.config/spolu/test.key
# path; content = the GitHub secret TEST_ENV_FILE (the server env file)
ENV_FILE=~/.config/spolu/test.env
# GitHub variable DOMAIN
DOMAIN=help.egrant.sk
# GitHub variable IMAGE; only a name now, nothing is pushed or pulled
IMAGE=ghcr.io/trayvor/spolu
# GitHub variable REDIRECT_DOMAINS; empty = no redirect
REDIRECT_DOMAINS=spolu.egrant.sk
# GitHub variable MAIL_FROM_NAME; optional
MAIL_FROM_NAME=Help by eGrant
# optional; the GitHub secret TICKETS_API_KEY; empty = keep the env file's
TICKETS_API_KEY=
# optional; default linux/arm64 (the test server is aarch64); linux/amd64; auto = ask the server (uname -m)
DEPLOY_PLATFORM=
```

Where the values come from:

- **Variables**: GitHub → the repository → **Settings → Environments → test** → *Environment variables*. Copy each one as it is.
- **Secrets cannot be read back from GitHub**, so the owner enters them again from the original source:
  - `TEST_SSH_KEY` → the private key of the `deploy` user (`~/.ssh/spolu_test` from [server-setup.md](server-setup.md), or a new key added with `server-setup.sh`), saved as the file `DEPLOY_SSH_KEY` points to, `chmod 600`;
  - `TEST_ENV_FILE` → the full server env file (template `deploy/test.env.example`, or a copy of the server's current `/opt/spolu/test/.env`, whose `IMAGE=` and `TAG=` lines `deploy.sh` replaces anyway), saved as the file `ENV_FILE` points to, `chmod 600`. `SUPERADMIN_EMAIL` (and `SUPERADMIN_NAME`) live in this file;
  - `TICKETS_API_KEY` → only if it was set as a separate secret; otherwise leave it empty (the env file's value is used).
- These files stay outside the repository; never commit them.

Pin the server's host key once (required: the script refuses to run without known hosts):

```bash
ssh-keyscan <DEPLOY_HOST> 2>/dev/null > ~/.config/spolu/test.known_hosts
chmod 600 ~/.config/spolu/test.known_hosts
ssh-keygen -lf ~/.config/spolu/test.known_hosts   # compare the fingerprints with the server console once
```

Instead of the file, `DEPLOY_KNOWN_HOSTS=<one ssh-keyscan line>` works too (the GitHub variable holds such a line); with both set, both are used.

## Manual deploy from a laptop

With a registry (GHCR); the local deploy above needs none.

Use it when CI is down, or to redeploy an older SHA (see [rollback.md](rollback.md)).

```bash
sha=$(git rev-parse HEAD)                     # must be pushed and built, or build it:
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
IMAGE=ghcr.io/trayvor/spolu scripts/build-image.sh "$sha"

DEPLOY_HOST=<host> DEPLOY_USER=deploy DEPLOY_SSH_KEY=~/.ssh/spolu_test \
DEPLOY_ENV_FILE=~/secrets/spolu-test.env DOMAIN=<test-domain> IMAGE=ghcr.io/trayvor/spolu REDIRECT_DOMAINS='<old domains or empty>' \
REGISTRY_USER=<github-user> REGISTRY_TOKEN="$GHCR_TOKEN" \
scripts/deploy.sh test "$sha"
```

`GHCR_TOKEN` is a GitHub token with `write:packages` (build) or `read:packages` (deploy only).

## Prod-like run on your machine

```bash
docker build -t spolu:local --build-arg APP_VERSION=local .
cp deploy/test.env.example deploy/.env   # then set IMAGE=spolu, TAG=local, DOMAIN=localhost, PUBLIC_URL=https://localhost and new secrets (the app refuses the example's placeholders)
cd deploy && docker compose --project-name spolutest up -d --wait
curl -k https://localhost/api/health      # {"status":"ok","db":"ok","version":"local"}
docker compose --project-name spolutest down -v   # separate project = separate volumes; removes them
```

The image has only `node`, no npm, corepack or yarn (see [overview.md](../architecture/overview.md), "Production image and compose"): in the container run `node` directly, e.g. `docker compose exec app node -e '…'`. A system package the app needs at runtime (for example ffmpeg) goes into the `RUNTIME_PACKAGES` default in the `Dockerfile` (space-separated Debian package names); try one locally with `docker build --build-arg RUNTIME_PACKAGES=ffmpeg -t spolu:local .`.

To walk the phase "Done when" locally (login codes included) catch the email in Mailpit (`docker compose -f docker-compose.dev.yml up -d --wait` from the repo root; UI on http://localhost:8025). For that set `EMAIL_DRIVER=smtp`, `SMTP_HOST=host.docker.internal` and `SMTP_PORT=1025` in `deploy/.env` before `up` (and clear `SMTP_USER` and `SMTP_PASSWORD`).

**Ticket intake (Phase 21).** Set `TICKETS_API_KEY` (at least 16 characters, for example `openssl rand -hex 24`) as its own secret of the `test` environment in GitHub (`gh secret set TICKETS_API_KEY --env test`); the deploy writes it into the server's `.env` (it replaces a `TICKETS_API_KEY=` line of `TEST_ENV_FILE`). Give it to the eGrant team with [integrations/egrant-ticket-intake.md](../integrations/egrant-ticket-intake.md). Without it `POST /api/tickets/intake` answers 503 `intake_disabled`. By default the same key also guards the eGrant managers webhook (`PUT /api/egrant/managers`, [guide](../integrations/egrant-managers.md)) and, once PR #113 is merged, the project webhook. Each can get a key of its own, so a leak of one does not open the others and each can be rotated alone: `EGRANT_MANAGERS_API_KEY` and `EGRANT_PROJECTS_API_KEY` in the server env file (at least 16 characters; `openssl rand -hex 24`). Unset, they fall back to `TICKETS_API_KEY`, so a server with only that key keeps working. Set them in the env file (`TEST_ENV_FILE` / `ENV_FILE`), then give eGrant the new key and update it on their side at the same time. Every eGrant webhook counts calls per IP before it checks the key, so wrong keys are rate limited too.

**Placeholder secrets.** In production the app refuses to start (`Invalid environment configuration: …`, naming only the variable) when `APP_SECRET` is the example files' `change-me-to-a-random-string-of-32-chars-or-more`, when `POSTGRES_PASSWORD` is `spolu` or `change-me`, or when `DATABASE_URL` uses one of those passwords on a host other than `localhost`/`127.0.0.1`/`[::1]` (the e2e server runs in production mode against the dev database). Only those exact values are refused. Generate real ones with `openssl rand -base64 48` (APP_SECRET) and `openssl rand -hex 32` (POSTGRES_PASSWORD); changing `POSTGRES_PASSWORD` of an existing database also needs `ALTER USER spolu PASSWORD '…'` inside the postgres container first.

**Domain.** `DOMAIN=` and `PUBLIC_URL=https://<domain>` in the server's `.env` come from the `DOMAIN` variable of the GitHub environment, not from `TEST_ENV_FILE` (`deploy_env` in `scripts/lib.sh`), so moving to another domain is: point its DNS A record at the server, change the variable, deploy. Caddy gets the new certificate on start.

**Fake push and AI.** `PUSH_PROVIDER=fake` (and `PUSH_FAKE_FILE`) and `AI_PROVIDER=fake` are for local development and e2e only; with `NODE_ENV=production` the app refuses to start with them unless `PUSH_ALLOW_FAKE=1` or `AI_ALLOW_FAKE=1`, which only the Playwright web server sets.

**AI task split.** Set `OPENAI_API_KEY` in the env file to turn on "Turn into tasks" (without it the action is hidden and `POST /api/messages/:id/task-split` answers 503 `ai_unavailable`). `OPENAI_MODEL` is optional (default `gpt-5-mini`). Never set `AI_PROVIDER=fake` on a server: it is a canned splitter for local development and e2e, and with `NODE_ENV=production` the app refuses to start with it (`ConfigError: AI_PROVIDER`) unless `AI_ALLOW_FAKE=1`, which only the Playwright web server sets. The key is never logged; each call logs one info line `ai task split` with the user, message, duration, outcome and token usage, so cost can be read from the logs (`docker compose logs app | grep 'ai task split'`).

**Chat AI text tools and voice input (Phase 28).** The same `OPENAI_API_KEY` turns on the composer's AI button (fix mistakes, make it formal, translate); its model is `OPENAI_TEXT_MODEL` (default `gpt-5.4-mini`) with `OPENAI_TEXT_REASONING_EFFORT` (default `low`; `off` for a model without reasoning such as `gpt-4.1-mini`). Voice input uses the meetings' transcription (`TRANSCRIPTION_PROVIDER`), so nothing new has to be set. Recordings are at most 8 MB (about 5 minutes) and are never stored. Per user: text 20 a minute and 300 a day, voice 10 a minute and 60 an hour. Each call logs `ai text tool` (user, channel, action, duration, outcome, token usage) or `ai voice` (user, channel, bytes, provider, duration, outcome), never the text.

**Meetings (Phase 30).** The OpenAI key above also covers the meeting summaries (`OPENAI_MODEL`) and the transcription (`TRANSCRIPTION_PROVIDER=openai`, the default; `OPENAI_TRANSCRIBE_MODEL`, default `gpt-transcribe`). Nothing new has to be set. To switch transcription to ElevenLabs Scribe set `TRANSCRIPTION_PROVIDER=elevenlabs` and `ELEVENLABS_API_KEY` (the app refuses to start with the first and not the second); `ELEVENLABS_STT_MODEL` is optional (`scribe_v2`). `TRANSCRIPTION_PROVIDER=fake` and `FFMPEG_PATH=fake` are for e2e only and refused in production without `AI_ALLOW_FAKE=1`. The image carries ffmpeg ([ADR 0023](../decisions/0023-ffmpeg-static-build-for-meeting-audio.md)); uploads of up to 2 GB go through Caddy unchanged (no body limit). Each summary logs `ai meeting summary` with the item, duration and token usage; a failed step logs its reason, never the transcript.

For real email on the test server use Elastic Email over SMTP: `EMAIL_DRIVER=smtp`, `SMTP_HOST=smtp.elasticemail.com`, `SMTP_PORT=465` (implicit TLS; `SMTP_SECURE` defaults to true on 465), `SMTP_USER` and `SMTP_PASSWORD` (both or neither). `EMAIL_DRIVER=elastic` with `ELASTIC_EMAIL_API_KEY` stays available (it then also needs `BULK_EMAIL_DRIVER=elastic`: the smtp bulk driver uses the SMTP settings). The SMTP sender marks every transactional email with the header `IsTransactional: True`.

**Bulk email (Phase 23).** Until the first real send nothing needs setting: `BULK_EMAIL_DRIVER` defaults to `EMAIL_DRIVER` (with `smtp`: the SMTP settings above, From `MAIL_FROM_BULK`, default `MAIL_FROM`). Before the first real send (spec "What the owner must do"): an Elastic Email API plan; an API key with `SendHttp`, `ViewSuppressions` and `ModifySuppressions` as `ELASTIC_EMAIL_API_KEY`; `BULK_EMAIL_DRIVER=elastic`; `MAIL_FROM_BULK` on a domain verified in Elastic (SPF, DKIM, DMARC); start with `BULK_EMAIL_UNSUBSCRIBE=elastic` (default) and Elastic's account setting **List-Unsubscribe header** on. Switch to `BULK_EMAIL_UNSUBSCRIBE=spolu` only after Elastic's support removed its forced unsubscribe link, with that setting off, and after one test send shows only Spolu's link and header. `BULK_EMAIL_PER_MINUTE` (default 120) bounds the send rate. With `BULK_EMAIL_DRIVER=elastic` the job `bulk-email.sync-suppressions` runs daily at 04:30 (Bratislava) and copies Elastic's unsubscribe and complaint lists into Spolu (it needs `ViewSuppressions`); in `elastic` unsubscribe mode a person who subscribes again in Spolu triggers `bulk-email.provider-resubscribe` (`DELETE /v4/suppressions/{email}`, needs `ModifySuppressions`). A failure of either shows in the logs and in pg-boss's failed jobs; it never blocks a page. The key is never logged. See [ADR 0016](../decisions/0016-bulk-email-through-elastic-v4-emails.md). Before the first real send, work through the [checklist below](#bulk-email-pre-launch-checklist).

## Bulk email pre-launch checklist

Bulk email (Phase 23) is built and tested locally against Mailpit; nothing of it has reached a real inbox yet. Before the first email to clients, the owner does these steps in order, on the test server first. None of them needs a code change.

1. **Elastic plan.** Move the Elastic Email account to a paid Email API plan. New and free accounts can only send to their own address.
2. **API key.** Create a key with the access levels `SendHttp`, `ViewSuppressions` and `ModifySuppressions`. Put it in the server env as `ELASTIC_EMAIL_API_KEY` and set `BULK_EMAIL_DRIVER=elastic`. Deploy.
3. **Sender.** Set `MAIL_FROM_BULK` (for example `eGrant <info@egrant.sk>`) to an address on a domain already verified in Elastic (SPF, DKIM, DMARC; today's `MAIL_FROM` domain is). Without it, bulk email goes out from `MAIL_FROM`. The send dialog shows the address in use, so you can check it there.
4. **List-Unsubscribe setting.** Keep `BULK_EMAIL_UNSUBSCRIBE=elastic` (the default) and turn **on** Elastic's account setting **List-Unsubscribe header** (Settings → Unsubscribe settings).
5. **Live check of the sender (plan part 23.1, Task 1.3 step 5).** Make a campaign whose audience is only you (Add a person), press **Send a test to me**, then send it for real to yourself. In the received mail, look at the headers and the footer link, and note:
   - the footer link goes through Elastic and ends on Spolu's page `/unsubscribe/<token>` (in `elastic` mode Elastic records an unsubscribe on the way);
   - the `List-Unsubscribe` and `List-Unsubscribe-Post` headers are there;
   - after unsubscribing and then ticking **Receive mailings** again in Settings, a next send reaches you (this tells whether Elastic's `DELETE /v4/suppressions/{email}` really lifts its suppression; if it does not, people who unsubscribed once stay suppressed on Elastic's side until support lifts it).

   If anything differs from this list, stop and report it before sending to clients.
6. **P5 check: login codes still arrive.** With a test address: send it a bulk email, unsubscribe through its link, then ask for a login code for that address. If the code does not arrive, switch the server's transactional mail to `EMAIL_DRIVER=elastic` (the transactional API) before sending to clients.
7. **Later, optional: Spolu-only unsubscribe.** Ask Elastic's support to remove the forced unsubscribe link for the account (they require a paid plan with sending history). When they confirm, turn the **List-Unsubscribe header** setting **off**, set `BULK_EMAIL_UNSUBSCRIBE=spolu`, deploy, and send one test to yourself: it must carry only Spolu's link and Spolu's own `List-Unsubscribe` header (this is the second half of the step 5 live check: whether Elastic keeps a header we pass).

After the first real campaign, open its report: **Sent** should match the recipients minus **Skipped**; **Failed** rows show the provider's message.
