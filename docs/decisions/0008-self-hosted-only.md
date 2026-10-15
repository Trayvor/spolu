# 0008 Self-hosted only

Date: 2026-10-15
Status: accepted

## Context
Spolu holds client conversations, files and contracts. Storing client data in third-party SaaS databases or storage is unacceptable for us.

## Decision
- All data (database, files, job queue) lives on infrastructure we run: Docker Compose on our own server (test: Oracle Cloud Free Tier VM).
- No SaaS databases or storage. Email delivery (Elastic Email) and, in a later phase, the Claude API are external services used only for sending mail and processing a request, not for storing data.

## Consequences
- We own backups, updates and security of the server (see runbooks).
- The stack is chosen to keep the number of moving parts small (ADR 0002, 0003, 0005).
- Images must support `linux/amd64` and `linux/arm64` since the test server is likely ARM.
