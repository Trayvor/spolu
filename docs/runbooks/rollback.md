# Rollback

How to go back to the previous version by redeploying the previous image tag. Every image is tagged with the commit SHA it was built from (`scripts/build-image.sh <sha>`), and `scripts/deploy.sh` deploys any tag that exists in the registry.

## Find the tag

- A failed deploy prints it: `To roll back: scripts/deploy-local.sh <env> <previous tag>` (or `scripts/deploy.sh …` for a registry deploy; read from `TAG=` of the server's `.env` before that deploy).
- Otherwise take the SHA of the last good merge on `main` (`git log --first-parent origin/main`) or of the last green **Deploy test** run (`gh run list --workflow deploy-test.yml`).
- `https://<domain>/api/health` shows the running version (`version` is the SHA).

The server keeps unused images for 7 days (`docker image prune --filter until=168h` in `deploy.sh`), so last week's tags start without a download; older tags are pulled from GHCR (registry deploy) or built and sent again (local deploy).

## Redeploy it

Either:

- **Local deploy** (the way since 2026-10-18): `scripts/deploy-local.sh test <old SHA>`. An old SHA is on `origin/main`, so no `--force-ref` is needed; if the server still has the image it is neither built nor sent. See [deploy.md](deploy.md#local-deploy-2026-10-18-github-minutes-exhausted).
- **GitHub** (manual workflow, needs Actions minutes): Actions → **Deploy test** → Run workflow, with `ref` = the old SHA. It runs `scripts/ci.sh` on that SHA again, builds (layers cached) and deploys it.
- **Laptop** (faster; the image already exists): the "Manual deploy from a laptop" command in [deploy.md](deploy.md) with `sha=<old SHA>` and without the build step.

`deploy.sh` waits until `/api/health` reports the old SHA. The next deploy of `main` deploys the bad commit again, so revert the bad commit on `main` (a pull request) before anything else is merged.

## Migrations

Migrations only go forward and run at boot. An older image starts on a database that already has newer migrations: it applies none and runs with the newer schema. That works as long as the newer migrations only added things (tables, columns with defaults, indexes). If one removed or renamed something the old code reads (for example migration 0023 dropped `tickets.file_links`), the old version fails on those queries: then either fix forward on `main`, or restore the database from the last nightly backup ([backup.md](backup.md)), which loses the data written since. Before a deploy with a destructive migration, take an extra backup (`BACKUP_ONCE=1`, see backup.md).
