# Non-functional requirements

Rules that apply to the whole product: installable PWA, Slovak and English interface, realtime updates, backups, error monitoring, no calls, and the design rule that the UI replicates egrant.sk.

## Requirements

- Technology and architecture: see `docs/architecture/overview.md`.
- The app is a **PWA**: installable on a phone and on a computer as an app.
- Interface languages: Slovak (SK) and English (EN) only at the start, with a language switcher.
- **Realtime everywhere:** all changes (messages, tasks, tickets) appear without reloading the page.
- Nightly database backup (Phase 1). Off-site backup and file backup (Phase 16, polish).
- Error monitoring (Phase 16).
- No calls or video calls.
- Minimum friction for the client: registration by link, only an email is needed.
- Design rule: The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill.
- The design covers colors, fonts, buttons, forms and cards.

## Phase

Phase 1 (PWA shell, SK/EN switcher, design extraction). Realtime applies from Phase 4 on. Nightly database backup: Phase 1. Off-site backup and file backup: Phase 16 (polish). Error monitoring: Phase 16.
