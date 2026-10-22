# Runbooks

Step-by-step operating guides for the test server (https://help.egrant.sk; `main` is deployed there with `scripts/deploy-local.sh` since 2026-10-18).

- [server-setup.md](server-setup.md): prepare a fresh server.
- [deploy.md](deploy.md): deploy a new version (local deploy from the Mac, GitHub Actions, Jenkins for the company server), proxy mode behind Apache, environment settings, moving to a new domain, the bulk email pre-launch checklist.
- [rollback.md](rollback.md): go back to the previous version.
- [backup.md](backup.md): back up and restore the database and files.
- [server-move.md](server-move.md): move all data (database and files) to another server: rehearsal, cut-over, rollback (`scripts/move-data.sh`).
- [audit-log-erasure.md](audit-log-erasure.md): replace a person's name in the audit log on an erasure request.
- [cloud-sessions.md](cloud-sessions.md): work on Spolu from Claude Code on the web.
