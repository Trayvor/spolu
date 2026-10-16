---
name: implement-phase
description: Use when starting, resuming or finishing a phase from docs/roadmap.md in Spolu — for example "implement Phase 3", "start the next phase", "continue the chat phase", or when asked what to build next.
---

# Implement a phase

## Overview

Every Spolu phase follows the same cycle: design, plan, test-driven implementation, docs, verification, roadmap status, then a pull request. The superpowers skills do the heavy lifting; this skill says which one to use when and adds the Spolu-specific steps. Do not skip or reorder steps, and do not start code before steps 1–4 are done.

Merging a pull request into `main` deploys it to the test server at https://help.egrant.sk (`docs/runbooks/deploy.md`), so a phase is `done` when its pull request is merged; the owner then walks its "Done when" there.

To resume a phase, find the first unchecked step whose output is missing (no spec in `docs/superpowers/specs/`, no plan in `docs/superpowers/plans/`, status not `in progress`, and so on) and continue from there.

## Checklist

Create a todo for each step.

1. **Read the phase.** Its entry in `docs/roadmap.md` (scope, "Done when", dependencies — every dependency must be `done`; if any is not, stop and tell the owner instead of continuing), the product docs it links, and the relevant `docs/architecture/*.md`. Work on a branch cut from a fresh `origin/main`.
2. **Design.** `brainstorming` with the owner → spec saved in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. If the phase has any UI, invoke `frontend-design` during design, and again before implementing each screen.
3. **Plan.** `writing-plans` → plan saved in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
4. **Roadmap start.** In `docs/roadmap.md` set the phase `Status` to `in progress` and link the spec and plan in its Design/plan column. Commit.
5. **Implement.** `subagent-driven-development`, every task test-first (`test-driven-development`). New feature areas follow the `new-module` skill. Use `requesting-code-review` between tasks as that skill says. When subagent-driven-development reaches `finishing-a-development-branch`, **do not merge, open a PR or discard yet**: finish steps 6–8 first, then do step 9.
6. **Docs.** Run the `update-kb` skill over the whole phase's changes.
7. **Verify.** `verification-before-completion`, with evidence for each:
   - `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (with your own `TEST_DATABASE_URL` when other agents run tests too, see `CLAUDE.md`);
   - end-to-end tests pass (`pnpm test:e2e`, or all checks at once with `bash scripts/ci.sh`). Only one e2e run at a time on a machine: when other agents work in parallel, leave it to whoever merges and say so in the pull request;
   - the initial JS stays under the budget if the phase touched eager code (`docs/architecture/performance.md`, "How to check");
   - optionally, walk the "Done when" on the local production-like stack (`docs/runbooks/deploy.md`, "Prod-like run on your machine").
8. **Roadmap done.** Set `Status` to `done` in `docs/roadmap.md` in the same pull request, and write in the phase's section what the owner still has to walk on https://help.egrant.sk after the merge. Commit.
9. **Integrate.** Rebase on `origin/main` (regenerate a migration whose number was taken, translate new keys into all nine languages), then run `finishing-a-development-branch` and open the pull request. Merge only when the owner (or the orchestrator acting for them) says so.

## Red flags

| Thought | Reality |
|---|---|
| "The phase is small, skip the spec" | Small phases still get a short spec and plan. |
| "Tests pass, so it's done" | Done means lint, typecheck, unit and e2e tests green, docs updated and the pull request ready. |
| "I'll merge it myself, CI is green" | Merging deploys to the server. Merge only when told to. |
| "This screen is simple, no need for frontend-design" | Any UI work invokes it first. No exceptions. |
| "Subagent-driven-development says finish the branch, so merge now" | Open the PR only in step 9, after docs, verification and the roadmap status. |
| "Docs can wait until the end of the phase" | Each commit already carries its docs; step 6 is the final sweep. |
