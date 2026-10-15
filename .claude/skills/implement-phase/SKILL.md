---
name: implement-phase
description: Use when starting, resuming or finishing a phase from docs/roadmap.md in eHub — for example "implement Phase 3", "start the next phase", "continue the chat phase", or when asked what to build next.
---

# Implement a phase

## Overview

Every eHub phase follows the same cycle: design, plan, test-driven implementation, docs, verification, roadmap status. The superpowers skills do the heavy lifting; this skill says which one to use when and adds the eHub-specific steps. Do not skip or reorder steps, and do not start code before steps 1–4 are done.

To resume a phase, find the first unchecked step whose output is missing (no spec in `docs/superpowers/specs/`, no plan in `docs/superpowers/plans/`, status not `in progress`, and so on) and continue from there.

## Checklist

Create a todo for each step.

1. **Read the phase.** Its entry in `docs/roadmap.md` (scope, "Done when", dependencies — all dependencies must be `done`), the product docs it links, and the relevant `docs/architecture/*.md`.
2. **Design.** `superpowers:brainstorming` with the owner → spec saved in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. If the phase has any UI, invoke `frontend-design:frontend-design` during design, and again before implementing each screen.
3. **Plan.** `superpowers:writing-plans` → plan saved in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
4. **Roadmap start.** In `docs/roadmap.md` set the phase `Status` to `in progress` and link the spec and plan in its Design/plan column. Commit.
5. **Implement.** `superpowers:subagent-driven-development`, every task test-first (`superpowers:test-driven-development`). New feature areas follow the `new-module` skill. Use `superpowers:requesting-code-review` between tasks as that skill says.
6. **Docs.** Run the `update-kb` skill over the whole phase's changes.
7. **Verify.** `superpowers:verification-before-completion`, with evidence for each:
   - `pnpm test` passes;
   - end-to-end tests (Playwright) pass;
   - the build is deployed to the test environment (see `docs/runbooks/deploy.md`);
   - walk the phase's "Done when" by hand **with the owner** on the test environment, item by item.
8. **Roadmap done.** Only after the owner confirms step 7: set `Status` to `done` in `docs/roadmap.md`. Commit.

## Red flags

| Thought | Reality |
|---|---|
| "The phase is small, skip the spec" | Small phases still get a short spec and plan. |
| "Tests pass, so it's done" | Done means deployed and walked through with the owner. |
| "I'll mark it done and the owner can check later" | `done` is set only after the owner confirms. |
| "This screen is simple, no need for frontend-design" | Any UI work invokes it first. No exceptions. |
| "Docs can wait until the end of the phase" | Each commit already carries its docs; step 6 is the final sweep. |
