# Design

## The rule

The UI replicates the design of https://egrant.sk. Any design work — scraping or analysing egrant.sk, copying its components, drawing or restyling any screen — MUST start by invoking the `frontend-design` skill.

## How to use `frontend-design`

Invoke the skill first, then do the work. Per kind of work:

- **Analysing or scraping egrant.sk** (colors, fonts, spacing, radii, shadows, logo usage): invoke the skill, then extract values into tokens.
- **Copying a component** (button, input, card, header): invoke the skill, then rebuild it with the shared tokens, not hard-coded values.
- **Drawing a new screen** (chat, board, lists have no equivalent on the website): invoke the skill, then adapt egrant.sk's look to the app.
- **Restyling an existing screen or component**: invoke the skill before changing any style.

Never hard-code colors or sizes. Use the theme tokens.

## Tokens

Tokens: filled in Phase 1 — will live in `apps/web/src/styles/theme.css` and `docs/design/tokens.md`.
