# Backup

How the database and uploaded files are backed up and how to restore them.

## What is archived

The `backup` service (`deploy/backup/backup.sh`) runs every night at `BACKUP_HOUR` (default 03:30, `BACKUP_TZ`) and writes two files with the same UTC timestamp into the `backups` volume (`/backups`):

- `spolu-<timestamp>.dump` — `pg_dump -Fc` of the database.
- `files-<timestamp>.tar.gz` — the `files` volume (`/data/files`: group logos and other uploads, with their `.meta.json` sidecars). The backup container mounts it read-only.

Each file is written as `.partial` and renamed when complete. The newest `BACKUP_KEEP` (default 14) of each kind are kept. Take an extra run with `BACKUP_ONCE=1`.

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

Restore the `.dump` with `pg_restore` into an empty database while the app is stopped.
