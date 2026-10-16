# Spolu documentation

Spolu is the eGrant team's internal web app for working with clients: group chat, direct messages, task boards, support tickets from eGrant, and contracts. It replaces Teams for client communication. These docs are the source of truth for requirements, architecture and decisions, written for AI agents first and readable by the owner.

## Reading order for a newcomer

1. [../README.md](../README.md)
2. [product/overview.md](product/overview.md)
3. [architecture/overview.md](architecture/overview.md)
4. [roadmap.md](roadmap.md)

## Directory map

| path | what lives there |
|---|---|
| [product/](product/README.md) | requirements, one file per module |
| [architecture/](architecture/overview.md) | system overview, [data-model.md](architecture/data-model.md), [realtime.md](architecture/realtime.md), [permissions.md](architecture/permissions.md), [performance.md](architecture/performance.md) |
| [decisions/](decisions/) | ADRs: one file per technical decision (`NNNN-title.md`) |
| [design/](design/README.md) | the egrant.sk design rule and design tokens |
| [runbooks/](runbooks/README.md) | server setup, deploy, rollback, backup |
| [integrations/](integrations/egrant-ticket-intake.md) | guides for outside developers: [eGrant ticket intake](integrations/egrant-ticket-intake.md) |
| [superpowers/specs/](superpowers/specs/) | per-phase designs |
| [superpowers/plans/](superpowers/plans/) | per-phase implementation plans |
| [superpowers/briefs/](superpowers/briefs/) | owner briefs for work not yet specced |
| [roadmap.md](roadmap.md) | phases with status |
| [glossary.md](glossary.md) | terms used in the project |

## How docs are maintained

Every change updates the affected docs in the same commit. Use the `update-kb` skill after a change: it finds the affected docs, updates them and adds an ADR when a decision was made. A Stop hook and `scripts/check-docs.sh` remind you when code changes without docs.
