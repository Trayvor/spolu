# 0002 Postgres job queue, no Redis

Date: 2026-10-15
Status: accepted

## Context
The original spec used Redis and BullMQ for jobs, plus a Redis adapter for Socket.IO. We need retried email and push sending and scheduled contract reminders. A single server handles tens of client organizations, and every extra service is something one person must run, back up and secure.

## Decision
- Use pg-boss: the job queue lives in PostgreSQL.
- Drop Redis and BullMQ. Socket.IO runs as a single instance without a Redis adapter.

## Consequences
- One less container and one less failure mode; PostgreSQL is already backed up.
- Queue throughput is lower than Redis, which is far above our needs.
- If we ever need several app instances, we add a Redis adapter for Socket.IO and revisit the queue; this is a new ADR.
