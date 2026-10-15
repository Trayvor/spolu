# Spolu — Phases 5 and 8: polish after the owner's walkthrough (design)

Date: 2026-10-15 · Status: approved by the owner in chat

Builds on [Phase 5](2026-10-15-phase-5-group-chat-design.md) and [Phase 8](2026-10-15-phase-8-task-board-design.md). Built on branch `integration` before it merges to main.

Out of scope (owner decision): a WYSIWYG composer. The chat composer stays as it is. The task chat stays in Phase 9.

## Chat

### C1. Replies to me count as unread

A message counts as unread for a user, on the Chat tab and in the groups list, when it is newer than the user's read mark and:

- it is a top-level message, as today; or
- it is a thread reply in a thread the user started or replied in; or
- it quotes ("Reply" inside a thread) a message by the user.

The user's own messages never count. In the feed, a thread with unread replies for the user shows a dot next to its "N replies" link until the user opens the thread. Opening the thread marks those replies read. The badge then drops by that number, live, as it does for the main feed.

## Task board

### B1. New task opens the full form

"Add task" in a bucket opens the task panel in create mode: the same `TaskForm` as the detail panel, with every field (title, description, assignees, deadline, urgent, files). The bucket is preselected and can be changed. Nothing is saved until "Create" (sk: "Vytvoriť"). Closing the panel discards the draft. Uploaded files are not attached, so the daily cleanup removes them. The old inline title-only quick add goes away.

### B2. Description

- The description field is at least 12 lines tall and grows with its content.
- It uses the chat composer's existing formatting (same toolbar, same markup, same renderer for display). There is no new editor.
- Reuse the chat components; do not copy them.

### B3. Form layout

- The bucket select in the panel header looks like the other selects in the app; the current pill with its broken chevron goes away.
- "Deadline" ("Termín") has its label above the field like every other field, with the same label-to-field gap.
- The urgent switch sits on its own row below the deadline, or beside it with matching alignment; choose whichever matches the other forms.

### B4. Done circle

- Every card has a round "done" control left of its title, with an accessible name of "Mark as done" / "Mark as not done".
- Checking it moves the task to the Completed bucket, at the top.
- Unchecking it, or a task in Completed that is unchecked, moves the task to To do, at the top.
- It uses the same move endpoint and the same `task.moved` notification events as a drag.
- In the Completed bucket every card's title is struck through and the circle is checked.
- The detail panel shows the same control next to the title.
- Anyone who can move tasks can use it, clients included.

### B5. Buckets

- "Add column" (sk: "Pridať stĺpec") sits after the last bucket, not after the first.
- Admins drag any bucket, fixed ones included, to reorder them. The order is stored per group and sent live to everyone viewing the board, as other board events are. Keyboard reordering works through the same drag library as the cards.
- Fixed buckets still cannot be renamed or deleted.
- Clients cannot reorder buckets: no drag handle, and the server refuses with 403.

## Testing

- Server: unread counts for all three reply cases and for the user's own messages; marking a thread read; bucket reorder (admin, client 403, fixed buckets included, live event); done/undone moves.
- Web: create-mode panel; done circle and strike-through; "Add column" position; bucket drag (admin only); form layout labels.
- E2E: an admin creates a task through the full panel and marks it done; it appears struck through in Completed.

## Done when

The owner, on the local production-like stack, sees a reply to their message counted as unread, creates a task through the full panel with a formatted description, marks a task done, and reorders buckets including the fixed ones.
