# Design tokens

The eHub theme, extracted from https://egrant.sk on 2026-10-15. The values live in `apps/web/src/styles/theme.css`; this page says where each one came from and how components use them.

## Source and method

egrant.sk is a WordPress block theme. Its design system is the `theme.json` output that WordPress inlines as `global-styles-inline-css` (`--wp--preset--*` and `--wp--custom--*` variables, plus element styles for `body`, `h1`–`h6`, `a` and buttons). Component styles come from the theme bundle `app/themes/egrant/assets/app/app-*.css` (header, fields, modal, footer) and the block stylesheets (`egrant-challenge-card`, `egrant-card-grid`). Values below are read from that CSS, not guessed from screenshots.

Reference screenshots (Playwright, Chromium, PNG compressed with pngquant) are in [screenshots/](screenshots/):

| File | Page | Shows |
|---|---|---|
| `home-desktop.png` | `/` at 1440×900 | nav pill, hero type, primary button, blog card |
| `home-mobile.png` | `/` at 390×844 | mobile nav pill, mobile type scale |
| `challenges-desktop.png` | `/vyzvy/` at 1440×900 | search field, selects, filter pills, white cards with progress bar |
| `contact-desktop.png` | `/kontakt/` at 1440×900 | form fields, labels, accent-border contact block |
| `demo-desktop.png` | `/demo/` at 1440×900 | form with submit button, screenshot of the eGrant app itself |

egrant.sk has **no dark mode** (no `prefers-color-scheme` rule anywhere). eHub has none either; `theme.css` has no `.dark` block. Add one only if the owner asks.

## Colors

| shadcn variable | Value | egrant.sk name | Observed on |
|---|---|---|---|
| `--background` | `#F5F3F1` | `base` | `body` background; header pill, dropdowns, modal panel |
| `--foreground` | `#141414` | `ink` | `body` text, headings |
| `--card` | `#FFFFFF` | `surface` | `.egrant-challenge-card`, `.egrant-field__input`, open nav panel |
| `--card-foreground` | `#141414` | `ink` | card text |
| `--popover` | `#F5F3F1` | `base` | `.egrant-header__lang-dropdown` (with lift shadow) |
| `--popover-foreground` | `#141414` | `ink` | dropdown items |
| `--primary` | `#141414` | `ink` | `.wp-element-button`, `.egrant-header__cta` background |
| `--primary-foreground` | `#FFFFFF` | `surface` | button text |
| `--secondary` | `#E4E2DD` | `surface-2` | `.egrant-header__lang-toggle`, `.egrant-header__subscribe`, "Odoberať výzvy" pill |
| `--secondary-foreground` | `#141414` | `ink` | text on those |
| `--muted` | `#F0EDEA` | `tile` | `.egrant-bottom-nav__items`, feature tiles |
| `--muted-foreground` | `#6B6B6B` | `muted` | `.egrant-field__label`, placeholders, result counts |
| `--accent` | `#E4E2DD` | `surface-2` | hover background of `.egrant-header__lang-option`, `.egrant-bottom-nav__item` |
| `--accent-foreground` | `#141414` | `ink` | |
| `--destructive` | `#E90000` | `error` | `.egrant-field--error .egrant-field__input` border, filled destructive button or badge. **Fills and borders only; never as text color** (use `text-error-ink`) |
| `--destructive-foreground` | `#FFFFFF` | — | text on a filled destructive button (egrant.sk has none; white chosen for contrast) |
| `--border` | `#E3DEDA` | `line` | hairlines, `.egrant-challenge-card__bar` track |
| `--input` | `#6B6B6B` | `custom.border.field` (`2px solid #6B6B6B`) | `.egrant-field__input` border at rest |
| `--ring` | `#141414` | `ink` | `.wp-element-button:focus-visible` outline (2px, offset 3px); focused input border |

Extra colors (Tailwind names in brackets):

| Variable | Value | egrant.sk name | Use |
|---|---|---|---|
| `--ink-hover` (`ink-hover`) | `#3B3A33` | `ink-hover` | filled button hover, card link hover text |
| `--surface-3` (`surface-3`) | `#D6D2C8` | `surface-3` | hover of secondary (`.egrant-header__lang-toggle:hover`) |
| `--neutral` (`neutral`) | `#5E5E5E` | `neutral` | link hover color (`a:hover` in global styles) |
| `--error-ink` (`error-ink`) | `#D60004` | `error-ink` | all error text: field messages, destructive menu items. Tailwind class `text-error-ink` (there is no `text-destructive` in components) |
| `--success` (`success`) | `#007A37` | `green` | positive states (logo gradient stop) |
| `--success-light` (`success-light`) | `#52C083` | `green-light` | |
| `--brand-purple`, `--brand-pink`, `--brand-blue`, `--brand-coral` | `#7654FF`, `#EB5ED4`, `#3242DC`, `#FF8A4C` | `purple`, `pink`, `blue`, `coral` | logo gradient and illustration accents; use sparingly (avatars, labels), never as large fills |

The live dot in the header "Výzvy" pill is `#64D01C` (hard-coded in `.egrant-header__challenges-dot`); it is not a token. Use `--success` for online/presence dots unless the owner wants the brighter green.

## Typography

| Token | Value | Observed on |
|---|---|---|
| `--font-sans` (source `--font-family-base`) | `"Saans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | `--wp--preset--font-family--saans`, set on `body` |
| Weight 500 | `Saans-Medium.woff2` | `body` (`font-weight: 500`) — the site's normal text weight; there is no 400 |
| Weight 600 | `Saans-SemiBold.woff2` | `h1`–`h6`, buttons, field labels, nav links |
| Letter spacing | `0.2px` | `body`, buttons, headings; `h1` uses `-0.6px`, `h2` `0`, captions `0.25px` |
| Line height | `1.25` body; `1.2` h3–h4; `1` h1–h2 (`38/36` under 900px) | global styles |

There is one family; no separate heading font, so no `--font-heading`.

Font files are self-hosted in `apps/web/public/fonts/` (copied from `https://egrant.sk/app/themes/egrant/assets/fonts/`), about 56 KB each, `font-display: swap`. Each file contains latin and latin-ext; all Slovak diacritics are present (checked with fontTools). They do not contain Cyrillic.

**License (open question for the owner):** Saans is a commercial font by Displaay Type Foundry; the files' license field forbids storing them on publicly accessible servers or redistributing them without a license. The owner must confirm that eGrant's Saans web license covers eHub (another domain and app). If it does not, delete the two files and the `@font-face` rules: the stack falls back to the system UI font with no other change.

Type scale (Tailwind `text-*` utilities; desktop value, then the value under 900px):

| Utility | Desktop | ≤ 900px | egrant.sk preset | Used for |
|---|---|---|---|---|
| `text-nano` | 11.2px | 11.2px | `nano` | tiny meta |
| `text-micro` | 12.8px | 12.8px | `micro` | field labels, captions, `h6` |
| `text-tiny` | 14px | 14px | `tiny` | header buttons, pills, bottom nav |
| `text-button` | 14.4px | 14.4px | `button` | buttons, input text, `h5` |
| `text-body` | 17.6px | 16.6px | `small` | body text, `h4` |
| `text-medium` | 22.4px | 17.6px | `medium` | `h3`, lead text, modal titles |
| `text-large` | 36px | 36px | `large` | |
| `text-xlarge` | 64px | 36px | `x-large` | `h1`, `h2` (page titles) |

For the app, page titles should normally use `text-medium` or `text-large`; `text-xlarge` is the website's hero size and is too big for app screens.

## Radius

| Tailwind | Value | egrant.sk name | Observed on |
|---|---|---|---|
| `rounded-sm` | 4px | `radius.sm` | small chips |
| `rounded-md` (`--radius`) | 8px | `radius.md` | `.egrant-field__input` |
| `rounded-lg` | 12px | `radius.lg` | |
| `rounded-xl` | 16px | `radius.xl` | `.egrant-challenge-card`, `.egrant-footer__box`, `.egrant-modal` |
| `rounded-nav` | 32px | `radius.nav` | header pill `.egrant-header__bar` |
| `rounded-full` | pill | `radius.pill` / `80px` | every button, filter pill, language toggle (circle) |

Dropdown panels use 20px and their items 14px; in eHub use `rounded-xl` and `rounded-lg` for those.

## Shadow

| Tailwind | Value | Observed on |
|---|---|---|
| `shadow-lift` | `0 0 8px 0 rgb(0 0 0 / 0.1)` | header pill, language dropdown, bottom nav |

Cards have **no shadow** (`.egrant-challenge-card { box-shadow: none }`): a white card on the `base` background is the separation. The theme also defines WordPress default shadows (`crisp`, `natural`, `deep` …) that the site does not use; they are left out.

## Spacing and layout

egrant.sk spacing presets are 4, 8, 12, 16, 20, 24, 32, 40, 48, 54, 64px — all on Tailwind's default 4px grid (`1, 2, 3, 4, 5, 6, 8, 10, 12, 16`) except 54. Use Tailwind's default spacing; no custom spacing tokens.

- Block gap between sections: 32px (`gap-8`).
- Page side padding: `clamp(20px, 4vw, 40px)`.
- Content width: 1280px; text measure 552px.
- Breakpoints the site uses: 640px (mobile nav), 900px (type scale), 1024px (header tagline hides).

## Components

### Button

- Primary: `bg-primary text-primary-foreground rounded-full`, `text-button` (14.4px) weight 600, padding `10px 20px` (header buttons: height 38px, `text-tiny`). Hover `bg-ink-hover`; active `#000`. Focus-visible: `2px solid ink` outline, `3px` offset.
- Outline: transparent background, `2px solid ink` border, `rounded-full`, same text (`.egrant-header__challenges`, mobile card CTA).
- Secondary: `bg-secondary`, hover `bg-surface-3` (`.egrant-header__lang-toggle`, "Odoberať výzvy").
- Icon button: 38×38 circle, `bg-secondary` (language toggle) or `bg-primary` (modal close/back).
- Full-width submit: primary, `w-full` (`.egrant-modal__submit`).
- shadcn's default button uses `rounded-md`; eHub's `src/components/ui/button.tsx` is already `rounded-full` with these variants (default, outline, secondary, ghost, link, destructive) and sizes (default 38px, sm, lg, icon). Badge is a pill too (extra `success` variant). Dropdown menu: `rounded-xl` panel, `rounded-lg` items, `shadow-lift`, no open/close animation.

### Input

- `bg-card`, `border-2 border-input`, `rounded-md`, padding `13px 18px`, `text-button` weight 500, text and placeholder `text-muted-foreground`.
- Focus, or once filled: border and text turn `ink`. egrant.sk removes the outline (`.egrant-field__input:focus { outline: none }`), but eHub **keeps the global `:focus-visible` ring** on inputs as well (accessibility); do not remove it.
- Label above the field, gap 10px: `text-micro` weight 600 `text-muted-foreground`; turns `ink` when the field is focused or filled.
- Error: border `destructive`, text and placeholder `error-ink`, message 8px under the field in `text-nano`/`text-micro`.
- Select and search look the same as the input (2px border, 8px radius, chevron or search icon inside).

### Card

- `bg-card rounded-xl`, padding 20px, no border, no shadow, on the `background` page color (`.egrant-challenge-card`).
- Link cards show a small 16px diagonal arrow top-right; hover changes text to `ink-hover` (no lift, no scale).
- Progress bar inside cards: 8px high, `rounded-full`, track `border` color, fill `ink`.
- Accent block: a 3px `ink` left border with 12px left padding and no background (`.egrant-card-grid .egrant-card`, contact person).

### Link

- Inherits color, no underline; hover color `neutral` (`#5E5E5E`). In long text (manuals) links are underlined and lose the underline on hover.
- Footer links on the dark box: white, underline on hover.

### Header / navigation

- A floating pill: fixed 24px from the top (12px on mobile, full width minus 12px each side), height 64px (54px on mobile), `bg-background`, `rounded-nav`, `shadow-lift`, max width 1152px. Logo 32px high on the left (140px wide on mobile), tagline next to it (hidden under 1024px).
- Right side: outline pill ("Výzvy" with a live dot and count), primary pill CTA, circular language toggle showing the code ("SK"), hamburger icon. Gap 12px.
- The menu opens inside the same pill: background turns `card`, large 22px weight-600 links.
- Language dropdown: `bg-popover`, `shadow-lift`, 20px radius, items with check mark for the active language, hover `bg-accent`.
- eHub header (Task 13): the egrant logo on the left, followed by the product name "eHub" set in `--font-sans` weight 600, `text-medium`, `ink`, separated from the logo by 12px — in the spot where the website shows its tagline. No separate eHub wordmark is drawn; ask the owner if they want one.

### Footer (reference only)

A dark box: `bg-foreground` (ink), `rounded-xl`, padding 32px, white logo (`egrant-logo-on-dark.svg`), white 20px weight-600 links.

## Brand assets

Saved in `apps/web/public/brand/` (egrant.sk belongs to the owner's company; reuse is allowed):

| File | Source |
|---|---|
| `egrant-logo.svg` | inline `<svg class="egrant-header__logo">` on egrant.sk, 212×40, ink text + gradient mark |
| `egrant-logo-on-dark.svg` | inline `<svg class="egrant-footer__logo">`, white text + gradient mark |
| `favicon.svg`, `favicon.ico` | `https://egrant.sk/app/themes/egrant/assets/favicon/` |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | same folder (`site.webmanifest`: `theme_color #140700`, `background_color #F5F3F1`) |

The PWA manifest should use `theme_color: #140700` and `background_color: #F5F3F1`, as egrant.sk does.

## Simplified for performance

These egrant.sk effects are deliberately left out (owner rule "Keep it light", see [README.md](README.md)):

- The multicolor gradient that fades in on button hover (`.wp-element-button:before`) and the gradient border on the outline pill hover. eHub uses a flat `ink-hover` background and a plain border.
- The animated gradient stripe in the modal (`egrant-modal-drift`, 20 s infinite animation, cross-fades).
- The hiding/showing header on scroll and the height animation of the opening nav pill (0.45 s cubic-bezier). eHub's header stays put; menus may fade in.
- The scrolling logo marquee, gallery and screenshot sliders.
- Transition lengths: egrant.sk uses 180–350 ms; eHub uses one `--duration-fast` of 150 ms, for color/opacity changes only. Under `prefers-reduced-motion: reduce` all transitions and animations are off (global rule in `theme.css`).
- Only two font weights (500, 600) are loaded, the same two the site uses.
