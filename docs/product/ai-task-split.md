# AI split of a message into tasks

When a client describes several tasks in one message, an AI analyses it and proposes separate tasks. The user reviews and edits a preview, and cards are created only after confirmation.

## Requirements

- Scenario: the client described several tasks in one message.
- Message action **"Split into tasks with AI"**.
- The AI analyses the message and proposes the **needed number of separate tasks** (title and description for each).
- The user sees a **preview** and can:
  - edit each task;
  - delete extra tasks and add new ones;
  - choose the bucket.
- Cards in the task board are created **only after the user confirms**.
- Example of done: a message with 5 tasks becomes 5 cards after the user's review.
- The AI is an LLM API (see `integrations.md`).

## Phase

Phase 11.
