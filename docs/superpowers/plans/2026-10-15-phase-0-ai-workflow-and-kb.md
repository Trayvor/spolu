# Phase 0 — AI Workflow & Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the repository, knowledge base, `CLAUDE.md`, project skills and docs-guard hooks in place before any product code exists.

**Architecture:** Plain Markdown knowledge base in `docs/` (Mermaid diagrams), a short root `CLAUDE.md` that points into it, three project skills in `.claude/skills/` layered on the superpowers plugin, and two shell guards (Claude Code Stop hook + CI script) that remind when code changes without docs.

**Tech Stack:** Git, GitHub (`gh` CLI), Markdown + Mermaid, Bash, Claude Code skills/hooks.

**Spec:** `docs/superpowers/specs/2026-10-15-ehub-foundation-design.md` (sections 4a, 7, 8). Source requirements: `SPEC.md`, `ROADMAP.md` (Ukrainian; translated here, then deleted).

## Global Constraints

- Everything written in English: docs, skills, comments, commit messages.
- No product code in this phase (nothing under `apps/` or `packages/`).
- Docs are for AI agents first but must be readable by a non-expert owner: short files, plain language, one Mermaid diagram where a picture helps.
- `docs/product/` becomes the single source of truth for requirements; `SPEC.md` and `ROADMAP.md` are deleted at the end of Task 2.
- Design rule wording (must appear verbatim in `CLAUDE.md` and `docs/design/README.md`): "The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill."
- Project skills build on superpowers; they never re-explain brainstorming/planning/TDD, they reference those skills by name.
- Per-phase specs go to `docs/superpowers/specs/`, plans to `docs/superpowers/plans/`.

## Review Focus

- Requirement lost in translation: every bullet of `SPEC.md` and every ROADMAP-only detail must land in `docs/product/` — Task 2 has a coverage checklist step.
- Stop hook infinite loop: the hook must not block again when `stop_hook_active` is true — tested in Task 6.
- Stop hook outside a git repo / no changes: must exit 0 silently — tested in Task 6.
- `check-docs.sh` must never fail CI (warn only) and must handle a base ref with no diff — tested in Task 6.
- Docs drifting from the design doc's decisions (e.g. Redis reappearing) — Task 7 fresh-session check.

---

### Task 1: Git repository and GitHub remote

**Files:**
- Create: `.gitignore`, `.gitattributes`, `README.md`

**Interfaces:**
- Produces: a git repo on branch `main` with remote `origin` (private GitHub repo).

- [ ] **Step 1:** `git init -b main` in the project root.
- [ ] **Step 2:** Write `.gitignore` covering: `node_modules/`, `dist/`, `build/`, `.env`, `.env.*` (but not `.env.example`), `deploy/*.env`, `coverage/`, `playwright-report/`, `test-results/`, `.DS_Store`, `*.log`, `.claude/settings.local.json`, `data/`.
- [ ] **Step 3:** Write `.gitattributes` with `* text=auto eol=lf` and `*.sh text eol=lf`.
- [ ] **Step 4:** Write a 10-line `README.md`: one-sentence purpose, "Start here: docs/README.md", "Working with AI: CLAUDE.md".
- [ ] **Step 5:** Commit: `git add -A && git commit -m "chore: initialize repository with spec and design"` (includes current `SPEC.md`, `ROADMAP.md`, `docs/superpowers/**`, `.claude/settings.json`).
- [ ] **Step 6:** Ask the owner for the GitHub owner/repo name (default `ehub`, private). Run `gh auth status`; if not logged in, ask the owner to run `! gh auth login`. Then `gh repo create <owner>/<name> --private --source . --remote origin --push`.
- [ ] **Step 7:** Verify: `git remote -v` shows origin; `gh repo view --json visibility` returns `PRIVATE`.

---

### Task 2: Product requirements in `docs/product/`

**Files:**
- Create: `docs/product/README.md`, `overview.md`, `roles-and-access.md`, `auth.md`, `groups.md`, `chat.md`, `direct-messages.md`, `task-board.md`, `ai-task-split.md`, `tickets.md`, `contracts.md`, `notifications.md`, `profile.md`, `integrations.md`, `non-functional.md`
- Delete: `SPEC.md` (end of task)

**Interfaces:**
- Produces: requirement files later tasks link to by these exact paths.

- [ ] **Step 1:** Translate `SPEC.md` into the files above, one topic per file, keeping every rule, field list, table and example (e.g. URL normalization `https://www.X.egrant.sk/` → `x.egrant.sk`). Each file starts with a one-paragraph summary, then `## Requirements` as a bulleted list, then `## Phase` naming the roadmap phase number(s) from design doc section 7.
- [ ] **Step 2:** Add the ROADMAP-only requirements to the matching files:
  - `auth.md`: superadmin auto-created from `SUPERADMIN_EMAIL`, cannot be deleted or demoted; superadmin creates admins by email; long-lived session; optional password (phase 16).
  - `groups.md`: members list; admin removes a client from a group.
  - `chat.md`: catch-up of missed messages after reconnect; edit/delete own messages; unread indicator; image previews; message marked "converted to task".
  - `notifications.md`: notifications for replies in threads the user took part in; admins notified about new tickets.
  - `profile.md`: name, avatar, language; message search within a group (phase 16).
  - `non-functional.md`: PWA installable; SK + EN with switcher; realtime everywhere; DB + file backups; error monitoring; no calls/video; UI replicates egrant.sk via `frontend-design` (Global Constraints wording).
- [ ] **Step 3:** Write `docs/product/README.md`: table `file | what it covers | phase(s)`.
- [ ] **Step 4: Coverage check.** Walk `SPEC.md` section by section (0–7) and `ROADMAP.md` phase by phase; for each bullet, `grep -ril "<key phrase in English>" docs/product` and tick it in a scratch checklist. Expected: every bullet found. Fix gaps before continuing.
- [ ] **Step 5:** `git rm SPEC.md` and commit: `docs: migrate product requirements to docs/product`.

---

### Task 3: Roadmap, glossary, design rule, runbook stubs, docs map

**Files:**
- Create: `docs/roadmap.md`, `docs/glossary.md`, `docs/design/README.md`, `docs/runbooks/README.md`, `docs/runbooks/server-setup.md`, `docs/runbooks/deploy.md`, `docs/runbooks/rollback.md`, `docs/runbooks/backup.md`, `docs/README.md`
- Delete: `ROADMAP.md`

**Interfaces:**
- Produces: `docs/roadmap.md` phase table with a `Status` column using exactly `planned | in progress | done`; skills (Task 5) update this column.

- [ ] **Step 1:** `docs/roadmap.md`: the 17-row table from design doc section 7 (phases 0–16) with columns `# | Phase | Status | Depends on | Design/plan`. Phase 0 = `in progress`, others `planned`; phase 0/1 link to their spec and plans. Below the table, one `##` section per phase with its scope bullets and "Done when" — for phases 0–5 from the design doc, for 6–16 translated from `ROADMAP.md` (original phase N becomes new phase N+4 for N = 2…12; original phase 1 became new phases 1–5). Renumber the "Depends on" column the same way (original dependency on phase 1 → new phase 5, unless only auth/groups are needed, in which case keep the earliest sufficient phase).
- [ ] **Step 2:** `docs/glossary.md`: alphabetical terms with one-line definitions — admin, superadmin, client, group, member, invite link, channel, message, thread, mention, seq, read state, bucket, task, task chat, ticket, contract, draft contract, reminder, egrant URL (and normalization), API key, PWA, OTP code, session.
- [ ] **Step 3:** `docs/design/README.md`: the design rule (Global Constraints wording), how to use `frontend-design` for each kind of work, and "Tokens: filled in Phase 1 — will live in `apps/web/src/styles/theme.css` and `docs/design/tokens.md`".
- [ ] **Step 4:** Runbook stubs: each file has a title, one sentence of purpose, and `> To be written in Phase 1.` `docs/runbooks/README.md` lists them.
- [ ] **Step 5:** `docs/README.md`: what eHub is (3 sentences), reading order for a newcomer (README → product/overview → architecture/overview → roadmap), a directory map table for every folder in `docs/`, and "How docs are maintained" (every change updates docs in the same commit via the `update-kb` skill).
- [ ] **Step 6:** `git rm ROADMAP.md`; commit `docs: add roadmap, glossary, design rule, runbook stubs`.

---

### Task 4: Architecture docs and ADRs

**Files:**
- Create: `docs/architecture/overview.md`, `data-model.md`, `realtime.md`, `permissions.md`, `docs/decisions/README.md`, `docs/decisions/0001-typescript-monorepo.md`, `0002-postgres-job-queue-no-redis.md`, `0003-disk-storage-behind-interface.md`, `0004-scripts-first-ci.md`, `0005-single-process-deployment.md`, `0006-better-auth-email-otp.md`, `0007-egrant-design-via-frontend-design.md`, `0008-self-hosted-only.md`

**Interfaces:**
- Consumes: design doc sections 4, 4a, 5, 6.
- Produces: ADR numbering `NNNN-kebab-title.md`; template in `docs/decisions/README.md` that `update-kb` uses.

- [ ] **Step 1:** `overview.md`: Mermaid flowchart of design doc section 5 (Browser/PWA → Caddy → app [API, Socket.IO, static web, pg-boss workers, Storage] → PostgreSQL), a "Where code lives" section with the module layout, the module boundary rule, and the "writes via HTTP, sockets push" rule. Plain-language paragraph per box.
- [ ] **Step 2:** `data-model.md`: Mermaid `erDiagram` of all section 6 entities; a table `entity | purpose | phase | status` with status `planned` for all (Phase 1 adds none of them). Note: "Fields are indicative until the entity's phase."
- [ ] **Step 3:** `realtime.md`: rooms per channel/group, the per-channel `seq` catch-up algorithm (client sends last seen `seq`, server returns newer messages ordered by `seq`), reconnect flow as a Mermaid sequence diagram, rule that sockets are push-only.
- [ ] **Step 4:** `permissions.md`: role table (superadmin/admin/client) × capability from `docs/product/roles-and-access.md`; rule "every module exports policy functions like `canReadGroup(user, groupId)` used by both HTTP routes and socket room joins; client-side hiding is cosmetic".
- [ ] **Step 5:** `docs/decisions/README.md`: ADR template (`# NNNN Title`, `Date`, `Status: accepted|superseded by NNNN`, `## Context`, `## Decision`, `## Consequences`) and an index table. Write ADRs 0001–0008 from the design doc, ≤ 25 lines each. 0002 explains why Redis/BullMQ were dropped; 0003 why MinIO was dropped; 0004 the GitLab+Jenkins migration motive.
- [ ] **Step 6:** Commit `docs: add architecture overview, data model, realtime, permissions, ADRs`.

---

### Task 5: `CLAUDE.md` and project skills

**Files:**
- Create: `CLAUDE.md`, `.claude/skills/update-kb/SKILL.md`, `.claude/skills/new-module/SKILL.md`, `.claude/skills/implement-phase/SKILL.md`

**Interfaces:**
- Consumes: paths from Tasks 2–4; superpowers skill names: `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:requesting-code-review`, `superpowers:verification-before-completion`; `frontend-design:frontend-design`.
- Produces: skill names `update-kb`, `new-module`, `implement-phase` (referenced by the hook in Task 6).

- [ ] **Step 1:** Invoke `superpowers:writing-skills` and follow it for the three skills below (frontmatter `name` + `description` starting with "Use when…").
- [ ] **Step 2:** `CLAUDE.md` (≤ 80 lines): purpose (2 lines); "Read first" links (`docs/README.md`, `docs/roadmap.md`); Rules (Global Constraints of design doc §8 item 3, design rule verbatim); Workflow ("start any phase with the `implement-phase` skill; after any change run `update-kb`"); Commands section with a placeholder line "Filled in Phase 1"; Where things live (one line per top-level folder).
- [ ] **Step 3:** `update-kb` skill: trigger "after any change to code, config, infra or behavior, before committing". Steps: list changed files (`git status`/`git diff --name-only`); map each to docs using a table (module code → `docs/product/<module>.md` + `docs/architecture/*`; schema/migrations → `data-model.md` status column; Docker/scripts/CI → `docs/runbooks/*`; new dependency or changed approach → new ADR; phase completion → `docs/roadmap.md` status; new term → `glossary.md`; UI tokens → `docs/design/`); update in the same commit; done-check "a new agent reading only docs would not be surprised by this change".
- [ ] **Step 4:** `new-module` skill: server folder template `apps/server/src/modules/<name>/{routes.ts, service.ts, policy.ts, schema.ts (drizzle tables), events.ts, *.test.ts}`; shared zod schemas in `packages/shared/src/<name>.ts`; web feature folder `apps/web/src/features/<name>/`; rules: policy functions tested first, writes via HTTP then emit socket event, no cross-module table access; UI → invoke `frontend-design:frontend-design` first; finish with `update-kb`. Mark the folder layout "authoritative from Phase 1; adjust this skill if Phase 1 changes it".
- [ ] **Step 5:** `implement-phase` skill: checklist — 1) read `docs/roadmap.md` entry + linked product docs; 2) `superpowers:brainstorming` → spec in `docs/superpowers/specs/`; any UI in the phase → `frontend-design:frontend-design` during design and implementation; 3) `superpowers:writing-plans` → `docs/superpowers/plans/`; 4) set roadmap status `in progress`, link spec+plan; 5) execute via `superpowers:subagent-driven-development` with TDD; 6) `update-kb`; 7) `superpowers:verification-before-completion`: `pnpm test`, e2e, deploy to test env, walk the phase's "Done when" by hand with the owner; 8) roadmap status `done`.
- [ ] **Step 6:** Commit `docs: add CLAUDE.md and project skills`.

---

### Task 6: Settings, Stop hook and CI docs check

**Files:**
- Modify: `.claude/settings.json`
- Create: `.claude/hooks/docs-reminder.sh`, `scripts/check-docs.sh`, `scripts/tests/check-docs.test.sh`, `scripts/tests/docs-reminder.test.sh`

**Interfaces:**
- Produces: `scripts/check-docs.sh <base-ref>` — prints `::warning::Code changed without docs/ changes. Run the update-kb skill.` when applicable, always exit 0. Phase 1 CI calls it.
- Produces: `.claude/hooks/docs-reminder.sh` — reads hook JSON on stdin.

- [ ] **Step 1: Write failing tests** `scripts/tests/check-docs.test.sh` (plain Bash, creates temp git repos, asserts with `[[ ]]` and exits non-zero on failure):
  - code-only change (`apps/x.ts`) vs base → output contains `::warning::`, exit 0;
  - code + `docs/a.md` change → no output, exit 0;
  - docs-only change → no output, exit 0;
  - no diff → no output, exit 0;
  - change under `packages/` counts as code.
- [ ] **Step 2:** Run `bash scripts/tests/check-docs.test.sh` → FAIL (script missing).
- [ ] **Step 3:** Implement `scripts/check-docs.sh`: `git diff --name-only "$1"...HEAD`; code = paths starting `apps/` or `packages/`; docs = `docs/`; `set -u`, never `set -e` on the diff (exit 0 even if the ref is missing — print a notice instead).
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5: Write failing tests** `scripts/tests/docs-reminder.test.sh` (temp git repo, pipe JSON to the hook):
  - uncommitted `apps/x.ts`, no docs change, input `{"stop_hook_active":false}` → stdout JSON with `"decision":"block"` and reason mentioning `update-kb`;
  - same but `{"stop_hook_active":true}` → no output, exit 0;
  - `apps/` and `docs/` both changed → no output;
  - clean tree → no output;
  - run outside a git repo → no output, exit 0.
- [ ] **Step 6:** Run → FAIL.
- [ ] **Step 7:** Implement `.claude/hooks/docs-reminder.sh`: parse `stop_hook_active` with `jq` (fallback grep if jq missing); changes = `git status --porcelain -- apps packages` vs `-- docs`; on hit print `{"decision":"block","reason":"Code under apps/ or packages/ changed but docs/ did not. Run the update-kb skill, or say why no docs change is needed."}`. `chmod +x` both scripts.
- [ ] **Step 8:** Run both test files → PASS.
- [ ] **Step 9:** Update `.claude/settings.json`: keep `superpowers@superpowers-marketplace: true`, add `"frontend-design@claude-plugins-official": true`; add `hooks.Stop` → command `"$CLAUDE_PROJECT_DIR"/.claude/hooks/docs-reminder.sh`. Validate with `jq . .claude/settings.json`.
- [ ] **Step 10:** Commit `chore: add docs guard hook and CI docs check`.

---

### Task 7: Phase verification

- [ ] **Step 1:** Dispatch a fresh general-purpose subagent with only: "Using only files in this repository, answer: (1) what eHub is and who uses it, (2) the runtime architecture and why there is no Redis, (3) what Phase 1 delivers and how it is verified, (4) the rule for UI design, (5) what you must do after changing code. Cite file paths." Expected: all five correct and consistent with the design doc; fix docs where the answers are wrong or missing.
- [ ] **Step 2:** `grep -rn "[А-Яа-яІіЇїЄєҐґ]" docs CLAUDE.md .claude/skills README.md --include=*.md | grep -v docs/superpowers` → no output (English everywhere; the brainstorm-era files under `docs/superpowers` are exempt).
- [ ] **Step 3:** Set Phase 0 status `done` in `docs/roadmap.md`, commit `docs: complete phase 0`, `git push`.
- [ ] **Step 4:** Tell the owner to read `docs/README.md` → `docs/architecture/overview.md` and confirm they understand the system (Phase 0 "Done when").
