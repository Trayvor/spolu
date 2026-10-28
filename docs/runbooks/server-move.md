# Moving to another server

How to move all of Spolu's data, the database and the uploaded files, from the current server to a new one (the company server of [ADR 0068](../decisions/0068-company-gitlab-jenkins-behind-apache.md)), with a rehearsal first and a short cut-over. `scripts/move-data.sh` does the copying and the checks. It runs on a machine that reaches both servers over SSH (the orchestrator's Mac) and streams everything through that machine.

## What moves

| What | Where | How |
|---|---|---|
| The database: every table, including pg-boss's queue (`pgboss.*`), the audit log, sessions, MCP tokens, passkeys and push subscriptions | volume `spolu_pgdata` | `pg_dump -Fc` and `pg_restore`, never a copy of the volume: the old server is arm64 (Oracle Cloud), so its data directory may not be readable on an amd64 server at all. A dump does not depend on the CPU or on `POSTGRES_PASSWORD` |
| Uploaded files (attachments, logos, meeting recordings, `.meta.json` sidecars) | volume `spolu_files` | `tar` with numeric owners (the app runs as uid 1000), without the app's `*.tmp` files |
| Secrets | `/opt/spolu/test/.env` | by hand, **the same values**: `APP_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and every integration key (SMTP or Elastic, OpenAI, Teams, `TICKETS_API_KEY`, `EGRANT_*`), into the Jenkins credential `help-prod-env` (see `deploy/prod.env.example`) |
| Teams certificate, if used | `/opt/spolu/test/secrets/teams.pem` | by hand, mode 600 ([deploy.md](deploy.md#microsoft-teams)) |
| Old nightly backups | volume `spolu_backups` | optional, as an archive |

Not moved: Caddy's TLS certificates (Apache terminates TLS in proxy mode), `media_work` and `media_socket` (temporary).

Why the values must stay the same: a new `APP_SECRET` logs everyone out, disconnects the Claude (MCP) connectors and breaks every link already sent (public meeting links, personal calendar feeds, unsubscribe links); new VAPID keys silently drop every push subscription. **Keep the domain `help.egrant.sk`**: passkeys are bound to it, and the MCP OAuth issuer is `PUBLIC_URL`. The files on disk are not encrypted (`APP_SECRET` only signs download links), so they can be copied as they are.

Size on 2026-10-22: database 55 MB (dump 3.8 MB, 108 tables), files 46 MB (118 files). The export took 13 seconds; the import a few seconds. Meeting recordings (up to 2 GiB each) will make the files grow fastest: measure again before the cut-over (`docker system df -v | grep spolu_` on the old server).

## The script

```bash
scripts/move-data.sh export [--live] <env> <dir>   # old server -> <dir> on this machine
scripts/move-data.sh import --replace <env> <dir>  # <dir> -> new server
```

`<env>` names the server's folder (`/opt/spolu/<env>`) and its SSH settings: `$SPOLU_DEPLOY_CONFIG`, or `~/.config/spolu/<env>.deploy`, the same file as `scripts/deploy-local.sh` ([deploy.md](deploy.md#the-config-file)); only `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS(_FILE)` are used.

- **export** refuses when the app or media service is running (pass `--live` for a rehearsal) and writes into a new, private folder: `spolu.dump`, `files.tar`, `counts.txt` (exact row count of each table), `files.sha256` (each file's checksum), `source.txt` (host, image `TAG`, time, live or not) and `SHA256SUMS`.
- **import** checks `SHA256SUMS`, refuses when the target runs another image `TAG` than the export (the migrations must match the data) or when its app or media service runs, then **replaces** the target's database (drop, create, `pg_restore --single-transaction`) and empties and refills its files volume, and compares row counts and file checksums with the export. A difference stops it with a diff (only a warning for a `--live` export). It never starts the app.

The export folder holds every message, file and personal record: keep it on an encrypted disk and delete it once the move is done.

## 1. Prepare the new server (sysadmin)

1. By hand, the company's way (not our `server-setup.sh`, which is for our own VMs): user `deploy` in the `docker` group with the owner's SSH key (the machine that runs `move-data.sh`) and the Jenkins key, `/opt/spolu` owned by it, Docker Compose 2.24.4 or newer ([deploy.md](deploy.md#what-the-sysadmin-sets-up)).
2. The Apache vhost and DNS as in [deploy.md](deploy.md#proxy-mode-behind-apache). If `help.egrant.sk` will point to a new address, lower its DNS TTL to 300 seconds a day or two before the cut-over.
3. Free disk: at least three times the data (data, nightly backups, the import stream).
4. On the Mac: `~/.config/spolu/prod.deploy` (chmod 600) with the new server's `DEPLOY_HOST`, `DEPLOY_USER=deploy`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS_FILE`, plus `ENV_FILE`, `DOMAIN`, `IMAGE`, `BEHIND_PROXY=1`, `HTTP_PORT`, `DEPLOY_PLATFORM=auto` and `HEALTH_CHECK_LOCAL=1` for `deploy-local.sh`. `HEALTH_CHECK_LOCAL=1` makes the deploy check the new server's local port: while DNS points to the old server, the public check would ask the old one (and pass, when both run the same commit). Remove it after the DNS switch.

## 2. Rehearsal (days before)

The copy is real data with real email addresses, push subscriptions and scheduled jobs. **A copy that starts with the production settings sends real reminders, digests and bulk emails to clients.** For the rehearsal, deploy with a separate env file, a copy of the prod one with these values changed (edit them, do not append duplicates):

```
EMAIL_DRIVER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1              # nothing listens: every email fails and stays in the copy's queue
BULK_EMAIL_DRIVER=smtp
ELASTIC_EMAIL_API_KEY=   # no Elastic calls (suppression sync)
PUSH_PROVIDER=fake
PUSH_ALLOW_FAKE=1
PUSH_FAKE_FILE=/tmp/push.jsonl
OPENAI_API_KEY=          # no transcriptions or AI calls billed twice
TEAMS_TENANT_ID=         # Teams off (and TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, TEAMS_CERT_*)
```

1. Deploy the **same commit** the old server runs (`TAG` in `/opt/spolu/test/.env`) to the new one, with the rehearsal env file as `ENV_FILE` in `prod.deploy`: `scripts/deploy-local.sh prod <sha>`.
2. On the new server: `cd /opt/spolu/prod && docker compose stop app media`.
3. `scripts/move-data.sh export --live test ~/spolu-move/rehearsal` (the old server keeps running).
4. `scripts/move-data.sh import --replace prod ~/spolu-move/rehearsal`.
5. On the new server: `docker compose up -d`, then `curl -s http://127.0.0.1:$HTTP_PORT/api/health`. Through an SSH tunnel (`ssh -L 8080:127.0.0.1:<HTTP_PORT> deploy@<new host>`, open `http://localhost:8080`) check a group page, a file download, a meeting recording and the finance page. Sign-in by email code does not work here (email is off); the check is that pages and files load.
6. Note how long each step took, then wipe the rehearsal: `docker compose stop app media` (the next import replaces everything anyway).

## 3. Cut-over

Announce a short maintenance window. All times below were seconds on 2026-10-22.

1. Make sure both servers run the same commit (deploy it to both first if `main` moved on). Deploy it to the new server with the **production** env file now (`ENV_FILE` in `prod.deploy` = the content of `help-prod-env`): `scripts/deploy-local.sh prod <sha>`, then `docker compose stop app media` there.
2. Old server: `cd /opt/spolu/test && docker compose stop app media`. From here nobody can write.
3. `scripts/move-data.sh export test ~/spolu-move/cutover`
4. `scripts/move-data.sh import --replace prod ~/spolu-move/cutover`. It must end with "match the export"; otherwise do not start the app (see rollback).
5. New server: `docker compose up -d`, check `curl -s http://127.0.0.1:$HTTP_PORT/api/health`.
6. Switch DNS (or the Apache vhost) to the new server and check `https://help.egrant.sk/api/health`, a sign-in by email code, a group page, a file and a push notification on a phone.
7. Take a backup right away: `docker compose run --rm -e BACKUP_ONCE=1 backup`, and check that the two files appeared ([backup.md](backup.md)).
8. Old server: `docker compose stop` (PostgreSQL too). **Do not delete it** for at least two weeks.
9. Remove `HEALTH_CHECK_LOCAL=1` from `prod.deploy`; from now on Jenkins deploys `main` ([deploy.md](deploy.md#jenkins)).

## Rollback

- **Before the DNS switch** (or when the import fails): start the old app again, `docker compose start app media` on the old server. Nothing is lost; the new server is simply not used.
- **After the switch**, once people wrote on the new server: going back loses those writes, unless they are moved back the same way (`export prod`, `import --replace test`, with the old server on the same `TAG`). So switch DNS only after the import's checks and step 5 passed.

## After the move

- Check the next nightly backup on the new server and do one test restore ([backup.md](backup.md)).
- eGrant's webhooks, Elastic Email and Microsoft keep working unchanged: they call or are called by `help.egrant.sk` with the same keys.
- Remove `.github/workflows/` and switch the wording to GitLab ([ADR 0068](../decisions/0068-company-gitlab-jenkins-behind-apache.md), Consequences).
- Delete the export folders on the Mac. After two weeks, shut the old server down.
