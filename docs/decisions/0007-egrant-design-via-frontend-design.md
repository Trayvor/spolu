# 0007 egrant.sk design via frontend-design

Date: 2026-10-15
Status: accepted

## Context
We do not want to invent a visual identity. eHub should look like our company website https://egrant.sk, adapted to an app (chat, boards, lists).

## Decision
- Replicate the egrant.sk look: colors, typography, spacing, buttons, forms, cards, icons, logo usage.
- All design work (analysing the site, extracting tokens, building or restyling any screen) must go through the `frontend-design` plugin skill. No UI is designed without invoking it first.
- The extracted design lives in Tailwind theme tokens and shadcn/ui CSS variables, and is documented in `docs/design/`.
- The rule is written in `CLAUDE.md` and the project skills, and the plugin is enabled in `.claude/settings.json`.

## Consequences
- A consistent look, with no design debates per screen.
- Screens with no egrant.sk counterpart are designed in the same style each time a phase starts.
- Changes to the website's design may require a deliberate token update.
