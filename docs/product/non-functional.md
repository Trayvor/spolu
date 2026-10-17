# Non-functional requirements

Rules that apply to the whole product: installable PWA, a nine-language interface, realtime updates, backups, error monitoring, no calls, and the design rule that the UI replicates egrant.sk, performance, and easy extension.

## Requirements

- Technology and architecture: see `docs/architecture/overview.md`.
- The app is a **PWA**: installable on a phone and on a computer as an app.
- Interface languages: Slovak (SK, the default for new accounts and emails), English (EN), Czech (CS), Slovenian (SL), Bulgarian (BG), Estonian (ET), Italian (IT), Croatian (HR) and Ukrainian (UK), with a language switcher. The chosen language is stored on the account; emails and pushes use it ([ADR 0019](../decisions/0019-nine-languages-and-one-email-design.md)).
- **Realtime everywhere:** all changes (messages, tasks, tickets) appear without reloading the page.
- **Lists remember their filters** (Phase 27, owner request): when a person comes back to a list, their last filters are there: per signed-in user, per list, and per client where the list belongs to one client (a group's Tickets or Knowledge tab). Kept in the browser, so on the same device only; blocked storage just means no memory. A link with filters in the address always wins and becomes the new memory. The free text search is never remembered. "Clear filters" (or choosing the defaults again) forgets them. Remembered today: the global task board (clients, assignee, urgent, "Only where I take part", deadline, "Show completed"), the Groups list (manager), the ticket lists (`/tickets` and each group's Tickets tab: status, area, riešiteľ, following, clients, "Without client"), the knowledge lists (`/knowledge`: clients, types, chat files; each group's Knowledge tab: types, chat files; and one List / Cards view for all knowledge lists) and a bulk email report's status filter (per campaign).
- Nightly database backup (Phase 1). Off-site backup and file backup (Phase 16, polish).
- Error monitoring (Phase 16).
- No calls or video calls.
- Minimum friction for the client: registration by link, only an email is needed.
- Design rule: The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill.
- The design covers colors, fonts, buttons, forms and cards.
- **Performance is a top priority.** The app must feel instant on a cheap phone over mobile data and on the small test server. In practice:
  - small JS bundles: each screen is lazy-loaded; no heavy library is added when a few lines of code will do;
  - no fancy visual effects: no heavy animations, parallax, blur/glass, or decorative motion. Only short, purposeful transitions (for example, a menu opening), and none when the user prefers reduced motion;
  - lists that can grow (messages, tasks, tickets) are paginated or virtualized, never loaded whole;
  - every query that filters or sorts uses an index; no query per row (N+1);
  - realtime events carry small payloads and go only to the rooms that need them.
- **Easy to extend.** After all phases the system must stay easy to change and to add features to, by one person with AI. In practice:
  - every feature is a self-contained module built the same way (`new-module` skill); modules talk only through exported service functions;
  - simple, repeated patterns over clever abstractions; no framework of our own;
  - docs, ADRs and tests are kept current with every change, so the next feature starts from accurate knowledge.

## Phase

Phase 1 (PWA shell, SK/EN switcher, design extraction); Phase 26 (seven more languages). Realtime applies from Phase 5 on. Nightly database backup: Phase 1. Off-site backup and file backup: Phase 16 (polish). Error monitoring: Phase 16.
