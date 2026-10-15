# Message to tasks with AI

Any chat message can be turned into task cards. An AI reads the message and proposes one card, or several when the message describes several jobs. The user reviews and edits every proposed card, approves or rejects each, and only approved cards are created.

## Requirements

- Every chat message (group chat and task chat) has the action **"Turn into tasks"**, next to "Reply in thread". It is shown to everyone who can read the chat (admins and clients).
- The message is sent to the AI (OpenAI API) with an instruction to return JSON: a list of one or more tasks, each with a title and a description (and an assignee or deadline only when the message states them clearly). The names of the message's files go too (never their contents), and the AI gives each file to the card or cards it belongs to.
- While waiting, the user sees a light "AI is working" animation.
- Then one screen shows every proposed card as the **full task form** (title, description, assignee, deadline, urgent). The user edits each card separately and **approves** or **rejects** each one.
- Approved cards are created in the **To do** bucket. Nothing is created without approval.
- The source message is then marked **"Turned into tasks"** with links to the created tasks.
- Limit: no limit (owner, 2026-10-15). Every call is logged with its token usage so the cost can be watched.
- Example of done: a message with 5 jobs becomes 5 cards after the user's review, and the message links to them.

## Phase

Phase 9. Status: the server side (AI client and `POST /api/messages/:id/task-split`) is built; the review screen and creating the cards follow in later Phase 9 tasks.
