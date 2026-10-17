# Bulk email builder layout: design

Date: 2026-10-17. Owner request of 2026-10-17, a follow-up to [Phase 31](2026-10-17-phase-31-bulk-email-builder-v2-design.md) (part of that phase in the [roadmap](../../roadmap.md#phase-31--bulk-email-builder-v2)). Requirements: [product/bulk-email.md](../../product/bulk-email.md). Decision record: [ADR 0025](../../decisions/0025-bulk-email-wide-layout-and-linked-preview.md).

## 1. The problem

1. In a big email the admin scrolls to the very bottom to see the result: the page is held to the app's 1152 px column, and with the admin sidebar the content area never reached the 1000 px the side-by-side preview needed, so the preview was always under the blocks.
2. In a split container's columns the editing controls overlapped: the forms laid out by the window width (`min-[641px]:`), so a half-width column got two 220 px selects side by side and a native select wider than its cell.
3. The email itself was too narrow for a split container: the computer preview frame was exactly 600 px, so the email's own `@media (max-width: 600px)` and `(max-width: 620px)` rules applied in it and the columns showed stacked; and a 520 px content column leaves 248 px a side.

## 2. The builder page

- **Full width.** While a draft is open, `<html data-wide-page>` widens the header and the main column from 1152 px to at most 1600 px (`in-data-[wide-page]:max-w-[1600px]` in `root.tsx` and `app-header.tsx`; set and removed by `useWidePage` in `editor-page.tsx`). Sections 2–4 (recipients, test, send) stay at most 1104 px wide, so their forms keep a readable width. Name, subject and preview line share one row from 1280 px.
- **Two panes** (`builder-workspace.tsx`), decided by a container query on the workspace, no resize listener:
  - **≥ 840 px of workspace** (a 1280 px laptop with the admin sidebar open has about 900 px): the blocks on the left (at least 360 px), the preview on the right (1.15 parts), **sticky** at the top of the window and as tall as the window, scrolling the email inside its own frame.
  - **Narrower** (tablets, phones): tabs **Blocks** / **Preview** under the Computer / Phone switch, one pane at a time; the preview pane is `min(80dvh, 880px)` tall. The tabs are underlined tabs, not a second pill, so they do not read as another edit mode. "Show phone preview" of the send warning opens the Preview tab.
- **The preview frame** (`preview-frame.tsx`) is a window of the real width, scaled down to fit the pane, never up: Computer 720 px (wider than the widest card plus its outer padding, so no phone rule fires), Phone 375 px. "Shown at 61 %" says when it is scaled. The email's media rules see the real width, so what the admin sees is what a client of that width shows.
- **Split container controls.** Every block card is its own size container (`@container` on the card): forms go to two columns only when the card is at least 480 px wide, selects are `w-full`, at most 320 px, and may shrink (`min-w-0`); **Move to…** moves to its own line in a card under 440 px. A container's two sides stack, left first, until the container card is 720 px wide, then sit side by side by the ratio, at least 300 px each. Checked at 1280 and 1600 px: no two controls of a container card intersect and none leaves the card.

## 3. The linked preview

- **Markers.** The preview route renders with `markBlocks: true`: each block's cell gets `data-sp-block="<id>"` (escaped), blocks inside containers too. Sent emails (test and real) never carry them (`send.test.ts`, `batch.test.ts`), and apart from them the preview is byte for byte the sent email (`render-v2.test.ts`). The 90 kB warning measures the HTML without the markers.
- **Sandbox.** The frame is `sandbox="allow-same-origin"` without `allow-scripts`: nothing in it runs (no script, inline handler, popup or form), and the editor can reach its document. The email is the server's output with every text escaped.
- **Highlight** (`preview-highlight.ts`, plain DOM, outside React): hovering a card outlines its block in the preview with a dashed 2 px brand purple (`#7654FF`) line; focusing anything in a card (editing) makes it solid and scrolls the preview (its own window only, never the page) so the block is in view. The card gets `data-hl="hover"` / `"active"`, a purple border. Every copy of a block is outlined (a separate phone version repeats ids). Inline styles only: the email's stylesheet is untouched, so its media rules stay as sent. Pointer moves over 50 cards never re-render the editor: the highlighter compares ids and touches only the marked elements.
- **Click to select.** A click in the preview never follows a link; it finds the innermost block, switches to the Blocks tab on a narrow screen, scrolls its card to the middle and focuses it (`tabIndex=-1`), which marks it active.

## 4. A wider email when it has a split container

- **Width.** When the **computer version** holds a split container, the card is **680 px** (40 px padding, a 600 px content column), else 600 px as before. 50-50 with a divider gives 287 + 288 px columns (was 247 + 248), 33-67 192 + 383 px. Every image and block of that email follows the 600 px column (an "Original" or 100 % image is up to 600 px). A container only in the phone version does not widen the computer card: the phone version shows only on phones, where the card is fluid.
- **Why 680 px.** Two columns of about 290 px fit a heading, a short text and a button without wrapping every second word. 680 px still fits Outlook for Windows' reading pane on a laptop (it reads the `width` attribute and the MSO table cells, and shows a horizontal scroll bar in a pane narrower than the card, as it would at 600 px), Gmail's message view in a browser window of 1024 px and up, and Apple Mail's message pane. Going further (700–800 px) gains little for the columns and starts to scroll in Outlook's reading pane beside the folder list.
- **Phone rules.** The card goes fluid below its width plus the 2 × 12 px outer padding: `@media (max-width: 704px)` for the 680 px card (620 px for the 600 px card, unchanged), so no client between 600 and 704 px scrolls sideways. The columns still stack, and a separate phone version still swaps in, at 600 px (the owner's number).
- **Clients without media queries** (Gmail with non-Google accounts, some webmail) keep the card at 680 px and the columns side by side, as they kept 600 px before.
- **No content-version bump.** The content version describes how stored blocks are read; the blocks did not change. Emails without a split container, every Phase 23 (version 1) email and every system email render byte for byte as before (`render-compat.test.ts`: the version 1 snapshots, plus a version 2 snapshot without a container recorded before this change; `layout-compat.test.ts`). Only emails with a split container change, a block type that reached production hours before. The one cost: a container email still sending when this is deployed renders a different body for a person whose send is retried after the deploy, and Elastic refuses a changed body under the same idempotency key (`422`), so such a person (at most one batch of 20) ends as failed; the report shows it. A version bump would have avoided that at the price of two layouts and of drafts whose test send and preview disagree until the next save.

## 5. Performance (measured 2026-10-17, local production build, a 44-block email with 5 containers, 27 kB HTML)

- Preview request (server render + round trip): median 51–77 ms, at most 120 ms.
- Debounce unchanged: one request 500 ms after the last keystroke, not one per keystroke; from the last keystroke to the new email on screen 820–870 ms.
- Each new version replaces the frame's document in place (`DOMParser` + `replaceChild`): 1.6–2.1 ms including layout, no reload, no flash, and the preview keeps its scroll position (checked: 2 858 px before and after).
- The builder chunk (`screens`) grew from 21.15 kB to 21.21 kB gzip; initial JS is unchanged apart from two class names in the header and the main column.

## 6. Tests

- Server: `render-v2.test.ts` (680 / 600 px card, 704 px card rule, column and image widths, a container only in the phone version, markers only on request and escaped), `render-compat.test.ts` (new version 2 snapshot), `render-routes.test.ts` (the preview carries the markers), `send.test.ts` and `batch.test.ts` (sent emails do not).
- Web: `preview-highlight.test.ts` (marks, escaping, every copy, innermost block, stripping the markers), `builder-workspace.test.tsx` (hover and edit marks, a block picked in the preview switches the tab and focuses its card, the preview document outlined), `editor-page.test.tsx` (the 720 px frame and the sandbox).
- E2E `e2e/bulk-email-builder.spec.ts`: no tabs at 1280 px, the 720 px frame and 680 px card with a container, hover outlines, a click in the preview focuses the card.

## 7. Not verified

Real Outlook for Windows, Gmail and Apple Mail rendering of the 680 px card (the HTML follows the same table technique as before; only the width changed). The highlight in Firefox and Safari (built on standard DOM: parent-added listeners on a same-origin sandboxed document; checked in Chromium only).
