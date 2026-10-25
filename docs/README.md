# Spolu documentation

Spolu is the code name of **Help by eGrant** (shown as "Help" at https://help.egrant.sk), the eGrant team's internal web app for working with clients: group chat, task boards, support tickets from eGrant, a knowledge base, bulk email, finance and projects per client; direct messages are planned. It replaces Teams for client communication. These docs are the source of truth for requirements, architecture and decisions, written for AI agents first and readable by the owner.

## Reading order for a newcomer

1. [../README.md](../README.md), and for AI agents [../CLAUDE.md](../CLAUDE.md) (rules, commands, tips)
2. [product/overview.md](product/overview.md)
3. [architecture/overview.md](architecture/overview.md)
4. [roadmap.md](roadmap.md)

## Directory map

| path | what lives there |
|---|---|
| [product/](product/README.md) | requirements, one file per module |
| [architecture/](architecture/overview.md) | system overview, [data-model.md](architecture/data-model.md), [realtime.md](architecture/realtime.md), [permissions.md](architecture/permissions.md), [performance.md](architecture/performance.md) |
| [decisions/](decisions/README.md) | ADRs: one file per technical decision (`NNNN-title.md`), indexed in its README |
| [design/](design/README.md) | the egrant.sk design rule, design tokens and [UI wording](design/wording.md) (terms per language) |
| [runbooks/](runbooks/README.md) | server setup, deploy, rollback, backup, cloud sessions |
| [integrations/](integrations/egrant.md) | guides for outside developers: **[eGrant integration guide](integrations/egrant.md)** (the entry point), [eGrant ticket intake](integrations/egrant-ticket-intake.md), [eGrant managers webhook](integrations/egrant-managers.md), [eGrant side implementation spec](integrations/egrant-agent-tz.md) (for the eGrant developers or their AI agent: every call, retries, backfill, acceptance tests), [MCP server](integrations/mcp.md) (connect an AI assistant), [Microsoft Teams setup](integrations/teams.md) (for the owner), [Elastic Email webhook](integrations/elastic-email.md) (bulk email tracking, for the owner) |
| [superpowers/specs/](superpowers/specs/) | per-phase designs |
| [superpowers/plans/](superpowers/plans/) | per-phase implementation plans |
| [superpowers/briefs/](superpowers/briefs/) | owner briefs (each says at the top whether it is done) |
| [roadmap.md](roadmap.md) | phases with status |
| [glossary.md](glossary.md) | terms used in the project |

## How docs are maintained

Every change updates the affected docs in the same commit. Use the `update-kb` skill after a change: it finds the affected docs, updates them and adds an ADR when a decision was made. A Stop hook and `scripts/check-docs.sh` remind you when code changes without docs.
