# Deploy

How a new version of Spolu (shown to users as Help by eGrant) gets to an environment. The only environment now is `test`.

> Task 18 finalizes this runbook after the first real deploy.

## How it works

All logic lives in `scripts/` ([ADR 0004](../decisions/0004-scripts-first-ci.md)); any CI system only prepares a runner, passes settings in as environment variables and calls:

1. `scripts/ci.sh` — every check: `pnpm install --frozen-lockfile`, shellcheck of `scripts/*.sh` and `deploy/backup/backup.sh`, `scripts/tests/*.test.sh`, the dev services from `docker-compose.dev.yml`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, Playwright Chromium + `pnpm test:e2e`, and `scripts/check-docs.sh "$CI_BASE_REF"` (default `origin/main`). No `.env` is needed. If the dev services were already running (your laptop) they are reused and left running; otherwise the script starts them and removes them on exit. `playwright install --with-deps` installs system packages, so the CI agent needs root or passwordless sudo (GitHub runners have it; a future Jenkins agent must too).
2. `scripts/build-image.sh <sha>` — `docker buildx build` for `linux/amd64,linux/arm64` with `APP_VERSION=<sha>`, pushed as `$IMAGE:<sha>`. The caller logs in to the registry first and provides a buildx builder with QEMU. Optional env: `EXTRA_TAG` also pushes `$IMAGE:$EXTRA_TAG` (the test deploy pushes `test`, so that tag always means "what test runs"); `BUILDX_CACHE=gha` uses the GitHub Actions layer cache (`mode=max`: build-stage layers are cached too, which speeds up the QEMU arm64 build; they hold no secrets since `.env` is in `.dockerignore`).
3. `scripts/deploy.sh <env> <sha>` — over SSH:
   - checks `REDIRECT_DOMAINS` and writes `redirects.caddy` from it (`caddy_redirects` in `scripts/lib.sh`; a bad name stops the deploy before anything reaches the server);
   - uploads `deploy/docker-compose.yml`, `deploy/Caddyfile`, `redirects.caddy`, `deploy/backup/` and the env file to `/opt/spolu/<env>/` (the env file becomes `.env`, mode 600, written with umask 077; `DOMAIN`, `PUBLIC_URL` and `REDIRECT_DOMAINS` in it always come from the deploy variables, see `deploy_env`);
   - sets `IMAGE=` and `TAG=` in that `.env` to the deployed image, so a manual `docker compose up -d` on the server runs the same version;
   - logs in to the registry if `REGISTRY_TOKEN` is set (and logs out after the pull), then `docker compose pull`, `docker compose up -d --remove-orphans`, `caddy reload` inside the `caddy` container (`up` does not restart Caddy when only its mounted Caddyfile or `redirects.caddy` changed), `docker image prune -af --filter until=168h` (removes unused images older than 7 days, old releases included, so the small disk does not fill; last week's images stay for a quick rollback);
   - polls `https://$DOMAIN/api/health` every 5 s for up to 120 s until `version` equals `<sha>`. On timeout it prints the last response, `docker compose ps` and the last 50 app log lines (the health body is shown even for a 503), the rollback command `scripts/deploy.sh <env> <previous tag>` (read from the server's `.env` before the deploy), and exits 1.

| deploy.sh variable | required | meaning |
|---|---|---|
| `DEPLOY_HOST` | yes | server hostname or IP |
| `DEPLOY_USER` | yes | SSH user, `deploy` (created by [server-setup.md](server-setup.md)) |
| `DEPLOY_SSH_KEY` | yes | path to that user's private key |
| `DEPLOY_ENV_FILE` | yes | path to the env file (template `deploy/test.env.example`) |
| `IMAGE` | yes | image repository, lowercase, e.g. `ghcr.io/trayvor/spolu` |
| `DOMAIN` | yes | public domain, for the health check; also `DOMAIN=` and `PUBLIC_URL=https://<domain>` of the server's `.env` |
| `REDIRECT_DOMAINS` | no | space-separated old domains, e.g. `spolu.egrant.sk`; each gets its own certificate and a permanent (301) redirect to `https://$DOMAIN` with the same path and query. Lowercase host names only, never `DOMAIN` itself. Unset or empty: no redirect, no extra certificate |
| `DEPLOY_PORT` | no | SSH port, default 22 |
| `DEPLOY_KNOWN_HOSTS` | no | `known_hosts` line(s) of the server (`ssh-keyscan <host>`); pins its host key. Recommended: without it there is no host verification (a warning is printed) |
| `REGISTRY_USER`, `REGISTRY_TOKEN` | no | registry login on the server for a private image |

Secrets are never printed. The SSH settings use a per-run `known_hosts` file, never the runner's `~/.ssh`.

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

Done at the deferred server-deploy step, on the test server with the VAPID keys set (see above), the owner and one test client. Each item is "Done when" of Phase 6 ([spec](../superpowers/specs/2026-10-16-phase-6-notifications-design.md#done-when)).

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

- `ci.yml` — on every pull request: Node 24, pnpm (version from `packageManager`), then `scripts/ci.sh` with `CI_BASE_REF=origin/<base branch>`.
- `deploy-test.yml` — on every push to `main`, or by hand (**Actions → Deploy test → Run workflow**, optional `ref` = branch, tag or SHA, so a branch can be tried on test before merge). Job `ci` runs `scripts/ci.sh` on that ref; job `deploy` (needs `ci`, GitHub environment `test`) sets up QEMU and buildx, logs in to `ghcr.io` with `GITHUB_TOKEN`, runs `scripts/build-image.sh <sha>` (`EXTRA_TAG=test`, `BUILDX_CACHE=gha`), writes the secrets to files with umask 077 and runs `scripts/deploy.sh test <sha>`. `<sha>` is `git rev-parse HEAD` of the `ci` job's checkout, passed as a job output; `deploy` checks out exactly that SHA, so the deployed commit is the tested one, also for a manual run with a `ref`. Concurrency group `deploy-test`: deploys queue, never cancel each other.

Settings of the GitHub environment `test` (**Settings → Environments → test**):

| kind | name | value |
|---|---|---|
| secret | `TEST_SSH_KEY` | private key of the `deploy` user (from [server-setup.md](server-setup.md)) |
| secret | `TEST_ENV_FILE` | full content of the server env file, filled from `deploy/test.env.example` |
| variable | `DEPLOY_HOST` | server hostname or IP |
| variable | `DEPLOY_USER` | `deploy` |
| variable | `DOMAIN` | public domain (`help.egrant.sk`); it overrides `DOMAIN` and `PUBLIC_URL` of the env file |
| variable | `REDIRECT_DOMAINS` | optional, old domains redirected to `DOMAIN` (`spolu.egrant.sk` after the move); see "Moving to a new domain" |

The senders' display name can also come from a variable: with `MAIL_FROM_NAME` set (for example `Help by eGrant`), `deploy_env` rewrites `MAIL_FROM=` and `MAIL_FROM_BULK=` of `TEST_ENV_FILE` to `<name> <their address>`, so renaming the sender needs no secret edit.
| variable | `IMAGE` | `ghcr.io/trayvor/spolu` (lowercase) |
| variable | `DEPLOY_KNOWN_HOSTS` | recommended, output of `ssh-keyscan <host>`; without it the host key is not verified |

The image is private (private repository), so the server logs in to GHCR with the job's `GITHUB_TOKEN` for the pull and logs out right after. Moving to another CI (GitLab + Jenkins) means writing these few steps again with the same variables; the scripts stay.

## Moving to a new domain

The product became **Help by eGrant** on 2026-10-16 and moves from `spolu.egrant.sk` to `help.egrant.sk` (the DNS A/AAAA records of `help.egrant.sk` already point at the server). Keep the old name's DNS pointing at the server too, or its redirect cannot work.

**How the redirect works.** `deploy/Caddyfile` ends with `import redirects.caddy`. `scripts/deploy.sh` writes that file from `REDIRECT_DOMAINS` on every deploy: unset or empty, it holds only comments, so Caddy starts cleanly and asks for no extra certificate; otherwise one site block lists the old domains, Caddy gets a certificate for each and answers `redir https://{$DOMAIN}{uri} permanent` (301, path and query kept). `REDIRECT_DOMAINS=` is also written into the server's `.env` as a record. Tests: `scripts/tests/deploy-env.test.sh` and `scripts/tests/caddy-redirects.test.sh` (with Docker it runs `caddy validate` on the real Caddyfile with and without old domains).

**Steps.**

1. In the GitHub environment `test`, set the variable `DOMAIN=help.egrant.sk` and add `REDIRECT_DOMAINS=spolu.egrant.sk`.
2. In the secret `TEST_ENV_FILE`, change the From display name: `MAIL_FROM=Help by eGrant <…>` (and `MAIL_FROM_BULK` if set). `PUBLIC_URL` there is overridden anyway.
3. Deploy (**Actions → Deploy test → Run workflow**, or the next push to `main`). The health check now polls `https://help.egrant.sk/api/health`.
4. Check: `curl -sI https://spolu.egrant.sk/groups?x=1` answers `301` with `location: https://help.egrant.sk/groups?x=1`; the app opens on `https://help.egrant.sk`; a login email links to `help.egrant.sk`.
5. Tell eGrant's developers the new intake URL `https://help.egrant.sk/api/tickets/intake` ([integrations/egrant-ticket-intake.md](../integrations/egrant-ticket-intake.md)). The old URL keeps answering through the redirect only for clients that follow redirects and resend the POST body (a 301 makes many HTTP clients switch to GET), so the switch must be made.

**What users notice.**

- Everyone signs in again on the new domain: the session cookie belongs to the old domain and is not sent to the new one.
- Push notifications must be turned on again on every device: a push subscription belongs to the site's origin. The app's "Turn on notifications" card asks again on the new domain; email notifications are not affected.
- An installed app (PWA) still opens the old address and is redirected to the browser. Remove it and install again from `https://help.egrant.sk`.
- Old links (in earlier emails, bookmarks, unsubscribe links) keep working through the redirect for as long as `REDIRECT_DOMAINS` keeps the old domain.
- Emails, the page title, the header and the installed app's name now say Help / Help by eGrant.

Keep `REDIRECT_DOMAINS` for at least a few months; removing it later (empty variable, deploy) makes the old domain stop answering.

## Manual deploy from a laptop

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
cp deploy/test.env.example deploy/.env   # then set IMAGE=spolu, TAG=local, DOMAIN=localhost, PUBLIC_URL=https://localhost and real-looking secrets
cd deploy && docker compose --project-name spolutest up -d --wait
curl -k https://localhost/api/health      # {"status":"ok","db":"ok","version":"local"}
docker compose --project-name spolutest down -v   # separate project = separate volumes; removes them
```

To walk the phase "Done when" locally (login codes included) catch the email in Mailpit (`docker compose -f docker-compose.dev.yml up -d --wait` from the repo root; UI on http://localhost:8025). For that set `EMAIL_DRIVER=smtp`, `SMTP_HOST=host.docker.internal` and `SMTP_PORT=1025` in `deploy/.env` before `up` (and clear `SMTP_USER` and `SMTP_PASSWORD`).

**Ticket intake (Phase 21).** Set `TICKETS_API_KEY` (at least 16 characters, for example `openssl rand -hex 24`) as its own secret of the `test` environment in GitHub (`gh secret set TICKETS_API_KEY --env test`); the deploy writes it into the server's `.env` (it replaces a `TICKETS_API_KEY=` line of `TEST_ENV_FILE`). Give it to the eGrant team with [integrations/egrant-ticket-intake.md](../integrations/egrant-ticket-intake.md). Without it `POST /api/tickets/intake` answers 503 `intake_disabled`.

**Domain.** `DOMAIN=` and `PUBLIC_URL=https://<domain>` in the server's `.env` come from the `DOMAIN` variable of the GitHub environment, not from `TEST_ENV_FILE` (`deploy_env` in `scripts/lib.sh`), so moving to another domain is: point its DNS A record at the server, change the variable, deploy. Caddy gets the new certificate on start.

**AI task split.** Set `OPENAI_API_KEY` in the env file to turn on "Turn into tasks" (without it the action is hidden and `POST /api/messages/:id/task-split` answers 503 `ai_unavailable`). `OPENAI_MODEL` is optional (default `gpt-5-mini`). Never set `AI_PROVIDER=fake` on a server: it is a canned splitter for local development and e2e, and with `NODE_ENV=production` the app refuses to start with it (`ConfigError: AI_PROVIDER`) unless `AI_ALLOW_FAKE=1`, which only the Playwright web server sets. The key is never logged; each call logs one info line `ai task split` with the user, message, duration, outcome and token usage, so cost can be read from the logs (`docker compose logs app | grep 'ai task split'`).

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
