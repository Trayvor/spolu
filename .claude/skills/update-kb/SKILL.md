---
name: update-kb
description: Use when you have changed code, config, infra or behavior in eHub and are about to commit, when a phase or task finishes, or when a hook says "Run the update-kb skill". Applies to every change, including small fixes, refactors and dependency bumps.
---

# Update the knowledge base

## Overview

`docs/` is the source of truth for eHub. The code and the docs that describe it change in the **same commit**. A later agent reads only `docs/` to understand the system, so stale docs are a bug.

Run this after any change to code, config, infra or behavior, before committing.

At a phase-end sweep, any gaps found go in a separate docs-only commit that names what it corrects; never amend or rewrite pushed commits.

## Steps

1. **List what changed.** Include staged, unstaged and new files:
   ```bash
   git status --short
   git diff --name-only HEAD
   ```
   On a branch with several commits, also check `git diff --name-only main...HEAD`.
2. **Map every changed file to docs** with the table below. One file can hit several rows.
3. **Read each affected doc and update it** so it describes the code as it is now. Edit the existing text; do not append "update:" notes.
4. **Stage the doc changes with the code** and commit them together.
5. **Done-check:** a new agent reading only `docs/` would not be surprised by this change. If it would, you are not done.

## Mapping

| What changed | Update |
|---|---|
| Module code `apps/server/src/modules/<name>/`, `apps/web/src/features/<name>/`, `packages/shared/src/<name>.ts` | the module's product doc `docs/product/<topic>.md` (find it in `docs/product/README.md`) and the matching `docs/architecture/*.md` (`overview`, `realtime`, `permissions`) |
| Permission rules or policy functions | `docs/architecture/permissions.md` |
| Socket events, rooms, catch-up | `docs/architecture/realtime.md` |
| DB schema or migrations | `docs/architecture/data-model.md`: fields and the `status` column (`planned` → `implemented`) |
| Docker, Compose, Caddy, `deploy/`, `scripts/`, CI workflow, env variables | the affected `docs/runbooks/*.md` |
| New dependency, replaced library, or changed technical approach | a new ADR in `docs/decisions/` (template and index in `docs/decisions/README.md`; next free `NNNN-kebab-title.md`; add it to the index). Never rewrite an old ADR; mark it `superseded by NNNN` |
| Phase started or finished | `docs/roadmap.md` `Status` column (`planned`, `in progress`, `done`) and its Design/plan links |
| New domain term, or a term used differently | `docs/glossary.md` |
| UI tokens, theme, shared components, egrant.sk design findings | `docs/design/` |
| Folder layout, commands, or workflow rules | `CLAUDE.md` and, if the module layout changed, `.claude/skills/new-module/SKILL.md` |

A change that matches no row (for example a pure test refactor) needs no doc edit. Say so explicitly in your summary.

## Red flags

| Thought | Reality |
|---|---|
| "It's a small fix, docs don't mention it" | Then check the docs say nothing wrong about it. Read, don't assume. |
| "I'll update docs in a follow-up commit" | Same commit. Follow-ups get forgotten and the hook cannot tell. |
| "The docs are roughly right" | Roughly right misleads the next agent. Fix the detail. |
| "No one decided anything, so no ADR" | Adding a dependency or changing an approach *is* a decision. |
| "data-model.md is only the plan" | The `status` column must match the migrations. |
