# Phase 31 — Bulk email builder v2: design

Date: 2026-10-17. Owner request of 2026-10-17 (approved to build the same night; the decisions below were taken by the builder and are listed for the owner in §9). Requirements: [product/bulk-email.md](../../product/bulk-email.md). Decision record: [ADR 0024](../../decisions/0024-bulk-email-content-v2.md). Plan: [Phase 31 plan](../plans/2026-10-17-phase-31-bulk-email-builder-v2.md).

## 1. Goal

The Phase 23 block builder gets: (1) text formatting, (2) image size, alignment and shape, (3) a split container with two columns, (4) a phone version of the email that follows the desktop version until it is edited, with a one-time warning before the first real send, and (5) a content version, so campaigns saved before still render byte for byte as before.

## 2. Content model (`packages/shared/src/bulk-email.ts`)

`BULK_CONTENT_VERSION = 2`. A campaign holds `blocks` (the desktop version) and `phoneBlocks` (`null` = the phone version follows desktop).

**Rich text, not HTML.** A text block is `{ id, type: 'text', align, content: BulkTextNode[] }`. The browser never sends HTML: it sends a document tree, and the zod schema is the allowlist.

- `BulkTextNode = { type: 'paragraph' | 'h2' | 'h3' | 'bullet' | 'ordered', align?: 'left' | 'center' | 'right', content: BulkInline[] }`. A list is a run of consecutive `bullet` (or `ordered`) nodes, one node per item; no nested lists. A node without `align` takes the block's `align`.
- `BulkInline = { text, marks?: ('bold' | 'italic' | 'underline' | 'strike')[], href?, color? }`. `text` may hold `\n` (a line break). `href` is `http(s)://` or `mailto:` (re-checked when rendering). `color` is a key of `BulkPalette` (§2.1), never a CSS value.
- Limits: at most 5 000 characters of text in a block (as before), 200 nodes, 200 runs a node, each mark at most once.
- `{{name}}` stays plain text in a run and is replaced when rendering (the name is escaped, never linked or formatted). Plain `http(s)://` addresses in runs without a link still become links, as before.

### 2.1 The email palette

`BulkPalette` (keys → hex, from [design/tokens.md](../../design/tokens.md)): `ink` #141414 (the default), `muted` #6B6B6B, `green` #007A37, `red` #D60004, `purple` #7654FF, `blue` #3242DC, `line` #E3DEDA. Text colours are every key but `line` (too light on white); divider colours are `line` (default), `ink`, `muted`, `green`, `purple`, `blue`. There is no free colour picker.

### 2.2 Blocks

| type | v2 fields (new ones in bold) |
|---|---|
| heading | as before; `align` may now also be `right` |
| text | `align`, **`content`** (replaces `text`) |
| image | `imageId`, `alt` (required), `href?`, **`align?`** (`left`/`center`/`right`, default centre), **`width?`** `{ unit: 'percent', value: 10–100 }` or `{ unit: 'px', value: 40–520 }`, **`shape?`** `square` (default) / `rounded` (8 px) / `roundedLarge` (24 px) / `circle` (50 %) |
| button, logo | as before; `align` may be `right` |
| divider | as before |
| **spacer** | **`size`** `small` 16 px / `medium` 32 px / `large` 48 px |
| **columns** (split container) | **`ratio`** `50-50` / `33-67` / `67-33`, **`valign`** `top`/`middle`/`bottom`, **`divider`** boolean, **`dividerColor`** (palette key), **`left`**, **`right`**: lists of any block but `columns` (no nesting) |

At most 50 blocks in a version, counting the blocks inside containers. A container side may be empty.

### 2.3 Versions and the upgrade (decision: in-code upgrade on read)

`bulk_campaigns.content_version` (smallint, `1` for every row saved before Phase 31, check `in (1, 2)`). Reading a campaign calls `upgradeBlocks(version, raw)`: version 1 text blocks `{ text, align }` become paragraphs (split on a blank line, `**bold**` runs as `bold`, the same rules as the Phase 23 renderer); other blocks are unchanged. Every save writes version 2. A Drizzle (SQL) migration cannot parse `**bold**`, and a one-off data job would have to run before the first read; the upgrade on read has no window where old and new code disagree and is one pure, tested function. Sent campaigns keep version 1 forever, and that is fine: they render identically (snapshot tests recorded with the Phase 23 renderer before any change).

`phone_blocks jsonb null` holds the phone version, `phone_check_shown_at timestamptz null` the send warning (§5). Duplicate copies both versions and the content version, not the warning.

## 3. Rendering (`apps/server/src/infra/email/render.ts`)

The renderer stays pure and deterministic, all inline styles, tables for layout.

- **Text nodes.** `paragraph` → `<p>` exactly as Phase 23 (16 px gap); `h2` 22/28 px and `h3` 18/24 px weight 600 with a 12 px gap; lists → `<ul>`/`<ol>` with `padding-left:24px` and `<li>` 4 px apart. Marks: `bold` → `<strong style="font-weight:600">` (as before), `italic` → `<em>`, `underline` / `strike` → one `<span style="text-decoration:…">`, `color` → `<span style="color:#…">`, a link → `<a href target="_blank" style="color:…;text-decoration:underline">`. The plain-text part: headings in capitals, `- item` / `1. item`, a link as `text (url)` unless the text is the URL.
- **Images.** Without `width` as before (own width, at most the column). With `width`: percent of the column it is in, or px capped at that column; the `width` attribute (Outlook reads it) and `width:100%;max-width:Npx` (fluid on phones); `height` from the stored ratio. `align` sets the cell's `align` and the margins. `shape` adds `border-radius`; Outlook for Windows ignores it and shows square corners (graceful fallback).
- **Split container.** One `role="presentation"` table, a row of three cells: left column, a 1 px divider cell (`bgcolor` + `background-color`; full height in every client, Outlook too), right column, 12 px padding each side of the divider. Column widths come from the ratio and the 520 px content column; images inside are capped at their column. `valign` on the cells. On screens up to 600 px the `@media` rules turn the cells into full-width blocks, left first, hide the divider and put 24 px between them. Decision: the cells are real table cells (the "ghost table" Outlook gets in the hybrid technique, here for every client) instead of `inline-block` divs, because an `inline-block` column cannot draw a divider as tall as the taller column; clients without media queries (Gmail with non-Google accounts, some webmail) keep the two columns side by side in the 600 px email, as they keep the whole email at 600 px.
- **Phone version.** When `phoneBlocks` is `null` the email is rendered once (no duplication), stacking columns on phones. Otherwise the card holds both: `<div class="sp-desktop">` (desktop rows) and, inside `<!--[if !mso]><!-->…<!--<![endif]-->`, `<div class="sp-phone" style="display:none;max-height:0;overflow:hidden;mso-hide:all">` (phone rows); `@media (max-width: 600px)` hides the desktop one and shows the phone one. Outlook for Windows never shows the phone version (conditional comment and `mso-hide:all`); any client without media queries shows desktop. The plain-text part is always the desktop version.
- **No change for old emails.** The `<style>` gets the column and phone rules only when the email has a container or a phone version, and blocks without the new fields render exactly as before; system emails (`layout.ts`) too. Snapshot tests guard both.
- **Size.** Gmail clips HTML over about 102 kB. The editor measures the preview's HTML and warns above 90 kB. 50 blocks of 5 000 characters can exceed it, and two versions double it.

## 4. Editor (web, `features/bulk-email/`, lazy route as before)

- **Rich text editor** (`rich-text-editor.tsx`, no new dependency): a `contenteditable` box (`role="textbox"`, labelled "Text") with a toolbar: style (Paragraph, Heading 2, Heading 3), Bold, Italic, Underline, Strikethrough, Link (an inline address field; `http(s)://` or `mailto:`), Remove link, Bulleted list, Numbered list, Align left / centre / right, Colour (the palette). Commands use the browser's editing commands; after every input the box's DOM is read back into the document tree (`rich-text.ts`, `domToNodes`), which keeps only what the schema allows (pasted HTML loses everything else). Typing `**word**` still makes it bold (as in Phase 23). A TipTap/ProseMirror editor was not taken: about 100 kB for a handful of commands.
- **Image** form: Size (Original, Percent of the column, Pixels) with a number, Alignment, Shape (Square, Rounded, Rounded more, Circle — "best for square images"), the alt text (required) and the link, as before.
- **Split container** form: Column ratio, Vertical alignment, Divider on/off and its colour; then "Left column" and "Right column", each a block list with its own Add block (every type but the container). Every block has **Move to…**, a select of the other places (the main email, either side of any container); a container cannot go into a container. Move up / Move down / Delete work inside a side as in the main list.
- **Spacer** form: Small / Medium / Large.
- **Computer / Phone** — the preview's switch moves above the blocks and becomes the edit mode; the preview shows the same device. The editor always opens in Computer.
  - "Phone version: follows the computer version" while `phoneBlocks` is `null`. The block list then shows the desktop blocks; the first edit made in Phone mode copies the desktop blocks at that moment, applies the edit to the copy and saves it as `phoneBlocks` (an edit that changes nothing does not copy). From then on: "Phone version: edited separately", desktop edits no longer change it, and **Return to the computer version** asks first, then sets `phoneBlocks` to `null`.
  - The pure functions `applyEdit(draft, mode, action)` and `returnToDesktop(draft)` (`phone-version.ts`) hold the rule.
- **Size warning** under the preview above 90 kB: "This email is about 95 kB. Gmail cuts emails over about 102 kB: shorten it or remove the phone version."

## 5. Send warning

When the admin clicks **Send…** (never the test) and the phone version still follows desktop and the warning was never shown for this campaign, a dialog "Check how the email looks on a phone" opens first: **Show phone preview** (closes, switches to Phone, scrolls to the preview) or **Send anyway** (the usual send dialog). Showing it calls `POST /api/bulk-email/campaigns/:id/phone-check` (admin, 204, idempotent, any state, 404 unknown; it changes neither `version` nor `updated_at`, so an open editor is not disturbed), which sets `phone_check_shown_at`; the DTO says `phoneCheckShown: boolean`, so a reload never shows it again. The server does not block a send without it: it is advice.

## 6. API changes

- `BulkCampaignDto`: `blocks` (desktop, always version 2), `phoneBlocks: BulkBlock[] | null`, `phoneCheckShown: boolean`.
- `PUT …/campaigns/:id`: `phoneBlocks` optional — left out keeps the stored phone version (an old tab cannot drop it), `null` makes the phone follow desktop.
- `POST …/preview`: `phoneBlocks` optional.
- `not_ready` problems may carry `phone: true` (a problem in the phone version; `no_blocks` when the phone version is empty). Images inside containers and in the phone version are checked too.
- `POST …/campaigns/:id/phone-check` (new).

## 7. Tests

- Server: renderer unit tests (formatting and sanitization incl. XSS attempts, image shapes and widths, the container incl. the Outlook-safe cells and the phone safeguards, desktop + phone output, an inheriting phone version rendered once), the compatibility snapshots (bulk and system emails), the upgrade, the schema (XSS through `href`, `color`, unknown marks and keys), the save and preview routes, the phone-check route and flag, nested image checks of `validateForSend`.
- Web: `phone-version.test.ts` (first phone edit breaks inheritance; no-op edits do not; desktop edits after the break leave the phone tree alone; return restores it), `rich-text.test.ts` (DOM → tree, pasted junk dropped, `**bold**`), the block reducer for containers, the send warning in `send-dialog.test.tsx`.
- E2E `e2e/bulk-email-builder.spec.ts` (written, run by the owner): build a split container, edit on phone, check the indicator and the send warning.

## 8. Out of scope

Drag and drop (the builder keeps buttons, as Phase 23), nested lists, more than two columns, free colours, fonts, image cropping, tables in text, `{{…}}` fields other than `{{name}}`.

## 9. Decisions for the owner

1. Text is stored as a document tree, not HTML; the schema is the allowlist (no HTML sanitizer library, no new dependency).
2. In-code upgrade on read with a `content_version` column instead of rewriting stored JSON in a migration.
3. The split container uses table cells stacked by media query (full-height divider everywhere) rather than `inline-block` hybrid columns; without media queries the columns stay side by side.
4. Phone switch at 600 px (the owner's number); the card's existing phone padding stays at 620 px.
5. The editor opens in Computer mode on every device (before: Phone on a phone), so an admin on a phone does not split the versions by accident.
6. The send warning is remembered when it is shown, whatever the admin then picks.
7. New: a spacer block (the request lists it among the blocks a container takes) and right alignment for heading, button, logo and image.
8. Text colours: ink, grey, green, red, purple, blue; pink and coral are left out (too little contrast on white).
