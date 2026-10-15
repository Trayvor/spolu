# 0005 Single-process deployment

Date: 2026-10-15
Status: accepted

## Context
The product is operated by one person and serves tens of client organizations. Horizontal scaling is a non-goal.

## Decision
- One Node process runs the HTTP API, Socket.IO, pg-boss workers and serves the built web app.
- Docker Compose runs three containers: `app`, `postgres`, `caddy` (automatic HTTPS). A backup job is added in Phase 1.

## Consequences
- Minimal operations: one image, one deploy, one place to look at logs.
- Workers share resources with the API; a heavy job can slow requests.
- Splitting workers into a separate container later is a config change, not a rewrite.
- Realtime state is in memory, so only one app instance can run (see ADR 0002).
