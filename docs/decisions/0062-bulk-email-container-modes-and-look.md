# 0062 Bulk email container: modes and a look on the stored `columns` block

Date: 2026-10-21
Status: accepted

## Context
Phase 31's split container (`type: 'columns'`, two columns `left` and `right`) was the only way to group blocks. The owner asked to turn it into a general "Kontajner" with two modes, simple (one area of blocks) and split (the two columns), and to give both a look: corner radius, background colour (the egrant palette or a custom hex) and inner space. Campaigns, drafts and phone versions already store split containers as JSON (`bulk_campaigns.blocks`, content version 2) and must render byte for byte as before.

## Decision
- **One block type, new optional fields.** The stored type stays `columns`; it gains `mode` (`plain` | `split`; left out = `split`), `radius` (whole px 0–32), `background` (a key of `BulkBackgroundPalette` or exactly `#RRGGBB`) and `padding` (`none`, `small`, `medium`, `large` = 0, 12, 24, 32 px). Nothing is migrated and the content version stays 2: an old container simply has none of the fields.
- **A simple container's area is `left`**; the shared schema refuses a `plain` container with blocks in `right`, and the renderer would still show them after the area. Switching modes in the editor moves the blocks (`withMode` in `blocks.ts`), so nothing is ever hidden. `ratio`, `valign` and the divider stay stored in simple mode.
- **Rendering** (`infra/email/render.ts`): the look is one wrapping table cell with `bgcolor` (Outlook for Windows) and inline `background-color`, `border-radius` and `padding`; the contents get the width minus the padding. A container without a look renders exactly the old markup, pinned by a snapshot recorded before the change (`render-compat.test.ts`). Only split containers make the email 680 px wide and add the stacking CSS. Values are re-checked against fixed tables and the hex pattern; nothing else reaches the HTML.
- **The palette of backgrounds** is light only (the egrant surfaces and 10 % tints of green, purple and blue), because the text stays ink; a custom hex is the admin's own choice.

## Consequences
- No migration, no new dependency; the preview and the sent email stay the one server rendering.
- MCP `get_bulk_campaign` returns the same JSON; its description names the container's fields.
- Outlook for Windows shows square corners (it ignores `border-radius`); the editor notes it under Corners.
- A future third mode (e.g. three columns) would be another `mode` value on the same block.
