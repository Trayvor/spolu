# 0025 A wider email for split containers, and a preview linked to the builder

Date: 2026-10-17
Status: accepted

## Context
After the builder v2 ([ADR 0024](0024-bulk-email-content-v2.md)) the owner found big emails awkward to build: the preview was under the blocks, the controls of a split container overlapped, and the email's columns looked stacked on a computer (spec: [builder layout](../superpowers/specs/2026-10-17-bulk-email-builder-layout-design.md)). ADR 0024 fixed the card at 600 px for every email and showed the preview in an `<iframe sandbox>` with no allowance, so the editor could not reach the preview's document.

## Decision
- **The card is 680 px when the computer version holds a split container**, 600 px otherwise; its phone rule moves to the card's width plus the outer padding (704 px). Columns and the phone version still switch at 600 px. No content-version bump: the stored blocks did not change, and every email without a container renders byte for byte as before (snapshots).
- **The preview carries block ids** (`data-sp-block`, the renderer's `markBlocks`, only on the preview route) and its frame is `sandbox="allow-same-origin"` without `allow-scripts`, so the editor outlines the hovered or edited block and turns a click into a selection. No script can run in the frame.
- **The frame is updated in place** (the new document parsed by `DOMParser` replaces the old root) instead of a new `srcdoc` each time, to keep the scroll position and avoid a flash.
- **The builder page uses the window's width** (up to 1600 px) through `<html data-wide-page>`, and the panes are decided by container queries.

## Consequences
- A container email that was sending when this was deployed may fail for the few people whose send is retried after the deploy (Elastic refuses a changed body under the same idempotency key); the report shows them. Accepted: the container shipped hours earlier.
- Outlook for Windows shows a horizontal scroll bar for a 680 px email in a reading pane narrower than that, as it did for 600 px in a narrower pane.
- `allow-same-origin` makes the preview document same-origin with the app; it stays safe only while the frame has no `allow-scripts` and the email HTML is the server renderer's escaped output. Adding `allow-scripts` to this frame would be a security bug.
- The highlight is plain DOM work outside React (no re-render of up to 50 cards on a pointer move).
