# Message to tasks with AI

Any chat message can be turned into task cards. An AI reads the message and proposes one card, or several when the message describes several jobs. The user reviews and edits every proposed card, approves or rejects each, and only approved cards are created.

## Requirements

- Every chat message (group chat and task chat) has the action **"Turn into tasks"**, next to "Reply in thread". It is shown to everyone who can read the chat (admins and clients).
- The message is sent to the AI (OpenAI API) with an instruction to return JSON: a list of one or more tasks, each with a title and a description (and an assignee or deadline only when the message states them clearly). The people list sent with it holds only the group's clients and managers, and a proposed assignee outside that list is dropped, but a mention in the message text still shows the person's name. The names of the message's files go too (never their contents), and the AI gives each file to the card or cards it belongs to.
- While waiting, the user sees a light "AI is working" animation.
- Then one screen shows every proposed card as the **full task form** (title, description, assignee, deadline, urgent). The user edits each card separately and **approves** or **rejects** each one.
- Approved cards are created at the top of the **To do** bucket, in the order shown, all at once or none. Nothing is created without approval. A message file kept on a card is copied onto it, so deleting the task never removes the message's file.
- The source message is then marked **"Turned into tasks"** with links to the created tasks.
- Limit: no limit (owner, 2026-10-15). Every call is logged with its token usage so the cost can be watched.
- Example of done: a message with 5 jobs becomes 5 cards after the user's review, and the message links to them.

## Phase

Phase 9. Status: built (local).

- Server: AI client and `POST /api/messages/:id/task-split`; creating the approved cards with `POST /api/groups/:id/tasks/from-message`, at the top of To do, all or nothing, message files copied.
- Review screen (as built, `apps/web/src/features/task-split/`): "Turn into tasks" sits in the message's "More" menu on desktop and in the phone action sheet, only while `GET /api/ai/status` says `taskSplit: true` and only on messages with text. It opens a dialog (a centred 720 px dialog on a computer, a full-screen sheet on a phone) that quotes the message and shows "AI is reading the message…" with three card outlines. The proposed cards then all show at once as compact summaries (title, two lines of description, assignees, deadline, urgent, the message files proposed for that card). A card is edited only after it is opened: on a computer it opens in place as the full task form (one at a time; opening another closes the first and keeps its edits), on a phone as a full-screen layer with "Done". Each summary has "Approve" and "Reject" (44 px), and the footer "Approve all". Approving a card that is not valid (an empty title) opens it with the error instead. A rejected card shrinks to one struck-through line with "Undo". "Create N tasks" works only when every card is approved or rejected and at least one is approved; it sends one request (a double click never sends twice). Message files on a card can be removed and new files uploaded; the message's files go as `messageFileIds` (copied), the uploads as `fileIds`. If creating fails with `invalid_assignee` (someone chosen stopped being a client or manager), the dialog shows "Someone you chose can't be assigned here any more.", keeps the cards and refetches the group's people. On success the dialog closes and a toast says "N tasks created" with "Open the board".
- Errors stay in the dialog: the AI did not answer (502, "Try again"), found no tasks (422, "Create one task by hand": one card with an empty title and the message text as description, opened for editing), AI not available (503), message deleted (404). A failed create keeps every card and says why (message deleted, a file no longer available, or try again).
- Closing: the backdrop does nothing; Escape or Cancel close at once when nothing was decided or edited, else ask "Discard the proposed tasks?".
