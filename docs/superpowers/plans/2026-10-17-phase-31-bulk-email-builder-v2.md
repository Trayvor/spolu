# Phase 31 — Bulk email builder v2: plan

Spec: [Phase 31 design](../specs/2026-10-17-phase-31-bulk-email-builder-v2-design.md). One pull request (`feat/bulk-email-builder-v2`), built test-first in this order:

1. **Baseline snapshots** of the Phase 23 renderer (`render-compat.test.ts`) and of a system email (`layout-compat.test.ts`), committed before any change.
2. **Shared schema v2** (`packages/shared/src/bulk-email.ts`): palette, text tree, image width/align/shape, spacer, columns, `BulkBlocksSchema` (50 counting nested), `phoneBlocks` in the draft and DTO, `phone` on `not_ready` problems; `bulk-email-content.ts`: `upgradeBlocks`, `flattenBlocks`, `countBlocks`, `imageIdsOfBlocks`, `splitBold`, `splitParagraphs`. Tests: `bulk-email-content.test.ts`, `bulk-email.test.ts`.
3. **Renderer** (`infra/email/render.ts`): text nodes and marks, image options, spacer, the container, desktop + phone; `layout.ts` builds its text as a tree. Tests: `render-v2.test.ts`, the compatibility snapshots unchanged, `render.test.ts` through the upgrade.
4. **Server**: migration 0030 (`phone_blocks`, `content_version`, `phone_check_shown_at`), upgrade on read in `service.ts` / `message.ts` (`contentOf`), save keeps the phone version when left out, duplicate copies it, `validateForSend` walks containers and the phone version, preview takes `phoneBlocks`, `POST …/phone-check`. Tests: `builder-v2.test.ts`.
5. **Web**: `blocks.ts` (container places, `place` action, `placesFor`), `phone-version.ts` (`applyEdit`, `returnToDesktop`), `rich-text.ts` + `rich-text-editor.tsx`, image / spacer / container forms, nested `block-list.tsx` with Move to…, `mode-bar.tsx`, controlled `preview-frame.tsx` with the size warning, the send warning in `send-dialog.tsx`; texts in the nine `bulkEmail` locale files. Tests: `blocks.test.ts`, `phone-version.test.ts`, `rich-text.test.ts`, `validation.test.ts`, `editor-page.test.tsx`, `send-dialog.test.tsx`.
6. **E2E** `e2e/bulk-email-builder.spec.ts` (and the send warning step in `e2e/bulk-email.spec.ts`), run by the owner.
7. **Docs**: product/bulk-email.md, design/README.md (email look), architecture/overview.md and data-model.md, ADR 0024, roadmap.
