# Backup

How the database and uploaded files are backed up and how to restore them.

## What is archived

The `backup` service (`deploy/backup/backup.sh`) runs every night at `BACKUP_HOUR` (default 03:30, `BACKUP_TZ`) and writes two files with the same UTC timestamp into the `backups` volume (`/backups`):

- `spolu-<timestamp>.dump` — `pg_dump -Fc` of the database.
- `files-<timestamp>.tar.gz` — the `files` volume (`/data/files`: group logos and other uploads, with their `.meta.json` sidecars). The backup container mounts it read-only.

Each file is written as `.partial` and renamed when complete. The dump and the files archive run independently: if one fails the other is still taken, and the run exits non-zero (logged as `FAILED ...`). The files archive skips the app's atomic-write temp files (`*.tmp`), and `tar` exit code 1 ("file changed as we read it") counts as success with a log line. The newest `BACKUP_KEEP` (default 14) of each kind are kept. Take an extra run with `BACKUP_ONCE=1`. A dump also holds the audit log (`audit_log`): rows the daily job deletes after 730 days, and labels replaced on an erasure request ([audit-log-erasure.md](audit-log-erasure.md)), live on in the kept dumps until they rotate out.

## Restore the files

1. Stop the app: `docker compose stop app`.
2. Pick the newest archive in the `backups` volume, then extract it into the `files` volume with a throwaway container (volume names are prefixed with the project name `spolu`):

   ```bash
   docker run --rm -v spolu_files:/data/files -v spolu_backups:/backups:ro postgres:17 \
     bash -c 'tar -xzf "$(ls -1 /backups/files-*.tar.gz | sort | tail -n 1)" -C /data/files'
   ```

3. Start the app: `docker compose start app`.

Extracting adds and overwrites files; it does not remove files created after the backup.

## Restore the database

This replaces the current data with the newest dump. Run it from the `deploy/` directory on the server.

1. Stop the app (PostgreSQL stays up): `docker compose stop app`.
2. Restore the newest dump with a one-off run of the `backup` service (same image as PostgreSQL, the connection variables and the `backups` volume are already set):

   ```bash
   docker compose run --rm --no-deps --entrypoint bash backup -c \
     'pg_restore --clean --if-exists --no-owner --dbname "$PGDATABASE" "$(ls -1 /backups/spolu-*.dump | sort | tail -n 1)"'
   ```

   `--clean --if-exists` drops and recreates each object, so no empty database is needed. Messages about objects that do not exist yet are harmless; any other error means the restore is incomplete, so do not start the app.

3. Start the app: `docker compose start app`. It checks the migrations at boot.
4. Check the sign-in and one group page. Restore the files too (above) when the files volume was lost as well.
