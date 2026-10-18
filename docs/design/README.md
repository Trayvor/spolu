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
- transitions only where they help the user follow what happened (a menu or sheet opens, a toast arrives, a screen appears), short (90 to 240 ms), CSS only, transform and opacity only, and off under `prefers-reduced-motion`; the motion tokens are in [tokens.md](tokens.md), "Motion";
- system or self-hosted fonts, few weights; images and icons small (SVG where possible).
- Menus of types (the chat "+" menu, the attachment picker tabs, the knowledge and finance "+ New" menus) put a 16 px outline icon (24-unit grid, 2 px stroke, `currentColor`, `aria-hidden`) before each label, reusing the type's own glyph; plain action menus (rename, move, delete) stay text-only.

When invoking `frontend-design`, pass this constraint with the request.

## Navigation and Back

Back (the browser button, Android's Back, the iOS swipe) and every in-app "Back", "Close" and "Done" follow the same rules, so Back always goes one step towards where the person came from:

- **Opening is a step, switching is not.** Opening a ticket, a task, a knowledge item or folder, a chat thread, a bulk email or a phone tile's list pushes a history entry. Switching group tabs, a task panel's tabs, filters and search text replace the entry.
- **Closing goes back.** "Close", "Back" and "Done" of something opened go one step back when the entry before is the app's own and the same screen without it (`backOr` in `lib/back.ts`; the router records each entry this tab shows), so Back never reopens what was just closed. Opened from a link from outside (an email, a notification, a reload), closing replaces the entry with the parent screen instead (the board, the list, the folder). A closed task panel returns to wherever the task was opened from (the board, home, a ticket, a chat).
- **Back closes the open layer first.** A sheet or dialog (`SheetDialog`, the phone "More" sheet's `BottomSheet` (`SectionSheet`), the message `ActionSheet`) gets a history entry of its own while open (`useBackCloses` in `lib/use-back-closes.ts`: the same URL with `state.layer`), so Back closes it and stays on the page; a layer closed in the app removes that entry again (a layer that slides out counts as closed as soon as it starts, and the next layer pushes its entry only once that step back has landed, so a quick close and reopen never leaves an extra entry). Layers whose open state is in the URL (a home tile's `?card=`, a knowledge item's `?k=`) are already a step and opt out (`urlOwned`). Links inside a layer replace its entry (the section menu), and so does the page a form opens after a submit (a new ticket).
- **Unsaved work asks first.** Back with unsaved changes asks before leaving, with the same question as the screen's own Close: the task panel, a knowledge item being edited, and the bulk email editor when its changes cannot be saved (invalid or failed). Closing the tab asks too.
- **No Back into a redirect.** Sign-in, the name step, sign-out, a 401 and accepting an invitation replace their entry, so Back never shows the login page, the name step or the invitation again (the route guards' own redirects always replace). `/t` replaces itself. A deleted bulk email draft is replaced by the list.
- **Scroll comes back.** The router restores the page's scroll position on Back and Forward (`scrollRestoration`); opening and closing a layer never scrolls the page.

## Wording

Every UI text, in all nine languages and in the server's emails and pushes, uses the terms in [wording.md](wording.md): one word per concept (manažér, Vymazať vs Odobrať, Znalosti, Financie, the column names), impersonal progress texts and quoted UI labels.

## Tokens

- [tokens.md](tokens.md) — every token with its value, where it was observed on egrant.sk and its shadcn variable; component notes (button, input, card, link, header); what was simplified for performance.
- `apps/web/src/styles/theme.css` — the tokens as CSS variables (shadcn names) plus a Tailwind v4 `@theme inline` block, the Saans `@font-face` rules and the global `prefers-reduced-motion` rule. Import it right after `tailwindcss`.
- `apps/web/public/fonts/` — self-hosted Saans woff2 (weights 500 and 600) and the Inter Cyrillic subset for Ukrainian and Bulgarian (see `tokens.md`).
- `apps/web/public/brand/` — egrant logo (light and dark backgrounds), favicons and PWA icons, and `egrant-logo-email.png` (the light logo as a 360×68 PNG, shown at 180 px in bulk emails because Gmail and Outlook do not show SVG). `pnpm --filter @spolu/web icons` writes the PNG icons and the email logo from the SVGs.

## Bulk email look

Every email, bulk and system (`infra/email/render.ts`, Phase 23; system emails since [ADR 0019](../decisions/0019-nine-languages-and-one-email-design.md)), applies the same tokens in a mail-safe form, all inline: the `base` page background, a white card (`rounded-xl` 16 px, 40 px padding, 28 px × 20 px on phones), `ink` text in the Saans stack with system and web-safe fallbacks (mail apps cannot load Saans), a 26 px weight 600 heading, 16/26 px weight 500 text, the primary button as an `ink` pill with white weight 600 text, `line` dividers, and a `muted` 13 px footer under the card. Admins never choose fonts; since Phase 31 they may format text (headings 2 and 3 at 22/28 and 18/24 px weight 600, lists, bold 600, italic, underline, strikethrough, links underlined) and pick a text colour or a split container's line colour from the email palette only (`BulkPalette` in `@spolu/shared`: ink, muted, success green `#007A37`, error-ink red `#D60004`, brand purple and blue; `line` for lines), and set an image's width, alignment and corner radius (8 px, 24 px or a circle). A split container is two table cells with a 1 px line between them and 12 px on each side, stacked on phones; an email with one is 680 px wide instead of 600 px. The builder itself uses the app's tokens: the Computer / Phone switch is the secondary pill switch on a `muted` bar with a status dot (`success` while the phone version follows, `attention` once it is separate), the text toolbar is a `secondary` strip of 32 px icon buttons (44 px on phones) inside the field's 2 px border, and a container's sides are `muted` panels. The block linked to the preview is marked in brand purple `#7654FF`, the one accent of the builder: a dashed 2 px outline in the preview on hover, solid while edited, and a purple card border; the Blocks / Preview tabs of narrow screens are underlined tabs (2 px `foreground` line), so they never read as a second edit-mode pill. A system email (login or email-change code, invite, digest, ticket created) is the logo, a heading, the one-time code as a second heading when there is one, its paragraphs and at most one button, with the footer "Help by eGrant" and a line that it was sent automatically; no unsubscribe link.
- [screenshots/](screenshots/) — reference captures of egrant.sk (desktop and mobile).
