# 0001 TypeScript monorepo

Date: 2026-10-15
Status: accepted

## Context
eHub is built and maintained by one person working with AI agents. The stack must be one that agents write reliably, and the compiler should catch breakage between client and server.

## Decision
- One git repo with pnpm workspaces: `apps/web`, `apps/server`, `packages/shared`.
- TypeScript everywhere, `strict`.
- Backend: Node.js LTS + Fastify. Database: PostgreSQL 17 with Drizzle ORM.
- Frontend: React + Vite, TanStack Router and Query, Tailwind CSS + shadcn/ui.
- zod schemas live in `packages/shared` and validate both API input and forms.
- Tests: Vitest and Playwright.

## Consequences
- Types and validation are shared, so a contract change breaks the build, not production.
- Docs and code live together and change in the same commit.
- One language to learn and operate; no separate backend ecosystem.
