# Integrations

eHub talks to three external systems: eGrant (incoming error reports), Elastic Email (all outgoing email) and an LLM API (task splitting).

## Requirements

- Systems and their purpose:

  | System | Purpose |
  |---|---|
  | **eGrant** | Incoming technical-error requests (JSON + API key) become tickets (see `tickets.md`). |
  | **Elastic Email** | Emails: invites, login codes, ticket replies, email notifications. |
  | **AI (LLM API)** | Splitting a message into tasks (see `ai-task-split.md`). |

## Phase

Elastic Email: Phase 2 (login codes), later invites, notifications (Phase 6) and ticket replies (Phase 13). eGrant: Phase 12. AI: Phase 11.
