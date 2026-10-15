# 0012 dnd-kit and fractional-indexing for the task board

Date: 2026-10-15
Status: accepted

## Context
The task board (Phase 8) moves cards between and inside buckets, and admins reorder custom buckets. Dragging must work with a mouse, on a phone (touch) and from the keyboard, with screen reader announcements in Slovak and English. Two people may drag at the same time, so the order must never get corrupted, and every move must be one small write.

## Decision
- **`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0** (exact versions) for dragging. They give mouse, touch (press and hold 250 ms) and keyboard sensors (Space picks up, arrows move, Space drops, Escape cancels), sortable lists across several containers, and live-region announcements that we translate (`tasks.dnd.*`). Rejected: native HTML5 drag and drop (no touch support, poor keyboard support, no announcements), and writing our own pointer and keyboard handling (a lot of subtle code to get right).
- **`fractional-indexing` 4.0.0** (about 1 kB) for order keys. A card's and a bucket's order is a string key; the **server** computes it from "place after X" (`afterTaskId`, `afterBucketId`) inside a transaction that locks the bucket rows, so concurrent moves queue and never collide. The client only uses the library for an optimistic key that places the card until the server answers (then the server's copy replaces it).
- Both libraries load only in the lazy Tasks chunk (`tasks-tab`); the task panel and the task form do not import them, and the initial bundle does not grow.

## Consequences
- One move is one `POST /tasks/:id/move` (or `PATCH /buckets/:id`) and touches one row; no renumbering of a whole bucket.
- Keys grow slowly when the same gap is split many times; at board sizes this does not matter, and a rebalance can be added later if it ever does.
- The Tasks chunk grows from about 4 kB to about 24 kB gzip (both libraries and the drag code).
- Keyboard dragging depends on element positions, so it is tested end to end in a real browser (jsdom has no layout); the drop logic itself is pure and unit tested (`features/tasks/drop.ts`).
