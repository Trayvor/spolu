# 0004 Scripts-first CI

Date: 2026-10-15
Status: accepted

## Context
We use GitHub and GitHub Actions now, but plan to migrate to GitLab and Jenkins on a different server. CI logic written only in Actions YAML would have to be rewritten and would be hard to run locally.

## Decision
- Real CI/CD logic lives in `scripts/`: `ci.sh`, `build-image.sh`, `deploy.sh <env>`, `server-setup.sh`.
- The GitHub Actions workflow is thin and only calls these scripts.
- Environments are chosen by name and configured by `deploy/<env>.env`.

## Consequences
- Migrating to GitLab and Jenkins means writing a new thin pipeline file, not new logic.
- Any step can be run and debugged on a laptop.
- Adding a `production` environment is configuration, not a refactor.
- Scripts need to be kept portable and documented in the runbooks.
