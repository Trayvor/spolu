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

## Keep it light

Performance comes before decoration (see `docs/product/non-functional.md`). Replicate egrant.sk's look — colors, fonts, spacing, components — but not heavy effects:

- no heavy animations, parallax, blur/glass, large background images or video, or decorative motion;
- transitions only where they help the user follow what happened, short (about 150 ms), CSS only, and off under `prefers-reduced-motion`;
- system or self-hosted fonts, few weights; images and icons small (SVG where possible).

When invoking `frontend-design`, pass this constraint with the request.

## Tokens

- [tokens.md](tokens.md) — every token with its value, where it was observed on egrant.sk and its shadcn variable; component notes (button, input, card, link, header); what was simplified for performance.
- `apps/web/src/styles/theme.css` — the tokens as CSS variables (shadcn names) plus a Tailwind v4 `@theme inline` block, the Saans `@font-face` rules and the global `prefers-reduced-motion` rule. Import it right after `tailwindcss`.
- `apps/web/public/fonts/` — self-hosted Saans woff2 (weights 500 and 600).
- `apps/web/public/brand/` — egrant logo (light and dark backgrounds), favicons and PWA icons, and `egrant-logo-email.png` (the light logo as a 360×68 PNG, shown at 180 px in bulk emails because Gmail and Outlook do not show SVG). `pnpm --filter @spolu/web icons` writes the PNG icons and the email logo from the SVGs.

## Bulk email look

The bulk email (`modules/bulk-email/render.ts`, Phase 23) applies the same tokens in a mail-safe form, all inline: the `base` page background, a white card (`rounded-xl` 16 px, 40 px padding, 28 px × 20 px on phones), `ink` text in the Saans stack with system and web-safe fallbacks (mail apps cannot load Saans), a 26 px weight 600 heading, 16/26 px weight 500 text, the primary button as an `ink` pill with white weight 600 text, `line` dividers, and a `muted` 13 px footer under the card. Admins choose content and order only, never colours or fonts.
- [screenshots/](screenshots/) — reference captures of egrant.sk (desktop and mobile).
