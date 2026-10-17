# 0024 Bulk email content v2: a document tree, a phone version and an upgrade on read

Date: 2026-10-17
Status: accepted (the 600 px card for every email and the preview sandbox without allowances: amended by [0026](0026-bulk-email-wide-layout-and-linked-preview.md))

## Context
The owner asked for formatted text (bold, italic, underline, strikethrough, links, lists, headings 2/3, alignment, palette colours), image size, alignment and shape, a split container with two columns, and a phone version of the email that follows the desktop one until it is edited (spec: [Phase 31](../superpowers/specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md)). Phase 23 stored a text block as a plain string with `**bold**`, the renderer built every block itself, and stored content is read again later (a campaign still sending when the new code is deployed, a duplicated sent campaign, a draft), so old campaigns must keep rendering byte for byte (a retried send must also render the same body for Elastic's idempotency key).

## Decision
- **Text is a document tree, not HTML.** A text block holds `content: BulkTextNode[]` (paragraph, h2, h3, bullet or numbered item; runs with marks, an http(s)/mailto link and a palette colour key). The browser never sends HTML; the shared zod schema is the allowlist (unknown keys stripped, links and colours checked), and the renderer escapes every text and looks colours, shapes and sizes up in fixed tables. No HTML sanitizer library and no rich text editor library: the editor is a small `contenteditable` with the browser's editing commands whose DOM is read back into the tree after each input (TipTap/ProseMirror would add about 100 kB to the lazy chunk for a handful of commands).
- **A content version and an upgrade on read.** `bulk_campaigns.content_version` (migration 0030; 1 for every older row, every save writes 2). `upgradeBlocks(version, raw)` in `@spolu/shared` turns a version 1 text into paragraphs with bold runs, exactly as the Phase 23 renderer read it, on every read (service, send, batch). A SQL migration cannot parse `**bold**`, and a one-off data job would need to run before the first read; the upgrade on read is one pure, tested function with no window where code and data disagree.
- **The phone version is a second block tree.** `phone_blocks` (null = follows desktop). The first edit in Phone mode copies the desktop blocks and applies the edit to the copy; "Return to the computer version" sets it back to null. The email carries both versions only when the phone one is separate (`.sp-desktop` / `.sp-phone` swapped by `@media (max-width: 600px)`, the phone one hidden from Outlook by a conditional comment and `mso-hide:all`); otherwise it is rendered once. The plain-text part is the desktop version.
- **Split container as table cells.** The two columns, the gaps and the divider are cells of one table row (the "ghost table" Outlook needs, used for every client) that stack on phones by media query, so the divider is as tall as the taller column everywhere; `inline-block` hybrid columns cannot draw that divider.
- **A one-time send warning** is remembered on the campaign (`phone_check_shown_at`, `POST …/phone-check`), not in the browser, so it survives reloads and other admins' editors.

## Consequences
- Old drafts and sent campaigns render byte for byte as before (`render-compat.test.ts`, `layout-compat.test.ts`: snapshots recorded before the change); the extra CSS is added only to emails that need it.
- Two shapes of stored blocks exist side by side until each old draft is saved again; every reader must go through `upgradeBlocks` (`getCampaign`, `contentOf`).
- A separate phone version doubles the HTML; the editor warns above 90 kB (Gmail clips at about 102 kB). The save and preview bodies may be up to 600 kB.
- Clients without media queries (Gmail with non-Google accounts, some webmail) show the desktop version and keep columns side by side; Outlook for Windows shows square image corners.
- `document.execCommand` is deprecated but implemented by every browser; if one ever drops it, the editor's toolbar needs its own DOM edits (the tree, the schema and the renderer stay).
