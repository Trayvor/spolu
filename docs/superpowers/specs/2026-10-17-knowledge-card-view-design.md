# Knowledge: card view (design)

Owner request of 2026-10-17, approved without a review round. Requirements: [knowledge-base](../../product/knowledge-base.md), "Card view".

## Goal

In the knowledge lists ("Znalosti"), a second way to show the items: cards that show more of each item's text than the one-line row does.

## Owner decisions (defaults we chose, approved)

1. **Toggle.** A two-button pill "List / Cards" (icons with labels for screen readers and a tooltip; 36 px high with a 44 px tap area) next to the search field, in each group's Knowledge tab and in the global `/knowledge` list. List is the default.
2. **Memory.** One choice per signed-in user for every knowledge list (the global list and all tabs), kept in the browser like the remembered filters (`spolu.filters.<user>.knowledge:view`, `useRememberedState`). It is not in the URL: a shared link opens in the reader's own view. Blocked storage just means List every time.
3. **Folders.** The folders stay rows (one card) above the item cards, as in the list view; breadcrumbs unchanged. Folder cards were rejected: they would mix two kinds of tiles in one grid and look like items.
4. **Grid.** One column on phones; two from a 576 px wide list, three from 896 px (container queries, so the tab and the global list each use their own width). The global list widens from 720 px to 1120 px while cards are on, so it can show three.
5. **Card content.** The row's leading tile (type icon, or the calendar leaf of a dated reminder or meeting), the title (two lines), the "Only eGrant" badge, the type's line (file name and size, link address, reminder's next time, meeting's date and state, chat source), then up to five lines of the excerpt, and at the bottom the author with the date, the attached-file count of a note, and, where the row shows them, the client (global list) and the folder path (search). Card heights in a grid row match; the footer sits at the bottom.
6. **Excerpt.** The list DTO's `excerpt` grows from 140 to 360 characters and keeps the body's line breaks, as plain text: the chat formatting marks are dropped (headings, quotes, bold, italic, strike, code, link targets; a bullet becomes "•"; code fences go), mentions show as names (only people of the item's group, as before), empty lines go, and a cut excerpt ends with "…". One field for both views, so realtime events and the detail stay consistent; the row still shows one truncated line of it.
7. **Opening.** The whole card opens the same detail dialog as a row (`?k=<id>`); a chat file opens the chat at its message. Inner links (file name, address) work on their own. Keyboard: Tab reaches each card's open button with a visible ring.

## Server

- `knowledgeExcerpt(body, nameOf, max)` in `packages/shared/src/knowledge.ts`; `toSummary` uses it on the page query's `left(k.body, 2000)` (already there), so the query, its indexes and pagination are unchanged and full bodies never reach the list.
- Permissions are unchanged: the excerpt is the item's own body, and only items the reader may see are listed. The meeting transcript and summary are never in it.

## Payload (measured 2026-10-17)

A page of 30 notes with 9.7 kB bodies, `JSON.stringify` of `listGroupItems`: 18 466 bytes at 140 characters, 25 036 bytes at 360 (+219 bytes per item, uncompressed; Caddy compresses it). The service test "a page of 30 long notes stays small" keeps it under 30 kB and checks no body is in it.

## Web

- `knowledge-card.tsx` (new), `view-toggle.tsx` (toggle and `useKnowledgeView`), `knowledge-list.tsx` (`view` prop: rows or a `<ul>` grid of cards), `folder-browser.tsx` passes `view`. The row's tile, overlay and type line are shared from `knowledge-row.tsx`.
- Not lazy-loaded: the card adds 0.7 kB gzip to the shared knowledge chunk (the tab and page chunks +0.05 and +0.09 kB, CSS +0.08 kB), less than the cost of one more request. Initial JS is unchanged.
- New texts `knowledge.view.{label,list,cards}` in all nine languages.

## Tests

Shared (`knowledgeExcerpt`), service (multi-line excerpt, payload bound), web (card, list grid, the tab's toggle and memory, the global list in cards), e2e `e2e/knowledge.spec.ts` "card view".
