# Phase 28 — Reactions and attached knowledge items (design)

Owner requests of 2026-10-17 in [roadmap.md](../../roadmap.md) ("Phase 28 — Chat editor and AI text tools": **Reactions** and **Attach a knowledge item**). This is one slice of Phase 28; the rich text editor, the AI text tools and voice input are built in parallel in their own pull requests. Product docs: [chat.md](../../product/chat.md), [knowledge-base.md](../../product/knowledge-base.md).

## Owner request

1. Reactions in every chat (group, task, ticket): a quick row 👍 ❤️ 😂 😮 😢 🙏 ✅ plus a lightweight picker; chips under the message with counts, mine highlighted, tap to toggle, a long press or hover lists who reacted; live over the socket after the HTTP write; no push or email (or at most a quiet one to the author: decide here); on phones the row opens from the message action sheet.
2. Attach knowledge items in a group's chats (group chat, its task and ticket chats): picked from a search dialog next to the file button; only items visible to everyone in the group, checked on send and again on display (later hidden, moved or deleted shows "unavailable"); a card with the type icon, title and folder that opens the item. In a ticket chat a žiadateľ gets no picker but opens the attached items read-only, only that item, with access granted through the message.

## Decisions (ours, for the owner to confirm)

1. **No notification for a reaction**, not even a quiet one to the author: no in-app event, push or email. A reaction is a light acknowledgement; the author sees it the next time they look.
2. **Who reacts:** everyone who reads the channel, a žiadateľ in their ticket chat included, on any live message (top-level or reply, their own too). A deleted message loses its reactions (they are deleted with it) and takes none.
3. **Any emoji**, one emoji per reaction (a Unicode emoji sequence: skin tones, ZWJ sequences, flags and keycaps pass; text does not; at most 32 UTF-16 units). A person may add several different emoji to one message. At most **20 different emoji per message** (a new one past that answers `400 validation_failed`).
4. **Write:** `PUT /api/messages/:id/reactions` with `{ emoji, on }` sets the actor's reaction (idempotent, so a retried tap never flips twice). Rate limit 60 a minute per user. A real change moves the message's `change_seq` (catch-up replays it, so a missed event is repaired) but not `edited_at`, the unread counts or `admin:activity`.
5. **Event:** a small `chat:reactions` event `{ groupId, channelId, taskId, messageId, parentId, changeSeq, reactions }` to the same rooms as `chat:message` (a ticket chat's initiator too), never the whole message.
6. **Payload:** `MessageDto.reactions` is `{ emoji, userIds }[]` in the order the emoji were first used; the web counts and highlights from it. Names of who reacted load on demand (`GET /api/messages/:id/reactions`, on hover or long press), so pages stay small; the names are those of whoever reacted, a žiadateľ sees them too (they are in the same chat).
7. **Picker:** no new dependency. A curated set of about 180 common emoji in eight groups lives in its own lazy chunk; the quick row is in the chat chunk. The desktop hover toolbar gets "Add reaction" (quick row in a popover, "More" opens the picker); the phone action sheet shows the quick row above its rows.
8. **Knowledge items per message:** at most 5. A message may consist of items only (no text, no files). Editing a message never changes its items; deleting it removes them.
9. **Who attaches:** whoever reads the group (admins and the group's clients), by the knowledge policy `canShareKnowledge`. A žiadateľ sending `knowledgeIds` gets `403 forbidden`; the web shows them no picker.
10. **Which items:** items of the channel's group with `visibility = 'public'` whose every folder up the tree is public (`isShareable` in the knowledge policy). Anything else on send answers `400 invalid_knowledge_item`. The picker lists only such items (`GET /api/groups/:id/knowledge?shareable=1`, search and types as in the tab).
11. **On display** each item is checked again, in one batched query per page: still in the channel's group, public, every folder public. Otherwise the card shows "Item unavailable" with no title or folder (the DTO carries only its id). A ticket chat moved to another client makes the old client's items unavailable. Rows have no foreign key to `knowledge_items`, so a deleted item stays as an unavailable card instead of vanishing from the message.
12. **Opening:** whoever reads the group opens the item in the usual knowledge dialog (their own rights apply there). A reader of the channel who does not read the group (a žiadateľ) opens `GET /api/messages/:id/knowledge/:itemId`: the message must be live and readable, the item attached to it and still shareable; the answer is the item's detail without reminders and without the chat source link, shown read-only. The item's own files are readable to them through a file read rule of the chat (`fileOfAttachedKnowledge`, registered with the ticket chat like `fileInReadableChannel`), never an admins-only file.
13. **No ADR:** no dependency and no new technical approach (a table per feature in the chat module, the existing batched DTO build, the existing event and catch-up rules).

## Data

Migration `0031_chat_reactions_knowledge` (chat module):

- `message_reactions (message_id → messages on delete cascade, user_id → user on delete cascade, emoji text, created_at)`, primary key `(message_id, user_id, emoji)`, index on `user_id` (the cascade).
- `message_knowledge_items (message_id → messages on delete cascade, item_id text, position int)`, primary key `(message_id, item_id)`, index on `item_id` (the file read rule).

## Server

- `modules/chat/reactions.ts`: `setReaction` (one transaction under the channel lock: `nextSeq`, the live check through the `change_seq` update, insert or delete, the 20-emoji cap; a no-op rolls back), `loadReactions(messageIds)` (one query) and `reactionPeople(messageId)`.
- `modules/chat/knowledge-links.ts`: `checkKnowledgeIds` on send, `loadMessageKnowledge(groupId, messageIds)` (one query for the rows, one for the cards), the read-through route helper and `fileOfAttachedKnowledge`.
- `modules/knowledge/shared-items.ts` (the knowledge side, its own tables only): `shareableItemCards(groupId, ids)` (items and their folder chains in two queries), `getSharedItem(groupId, id)`, `knowledgeItemIdsOfFile(fileId)`. Policy in `knowledge/policy.ts`: `canShareKnowledge`, `isShareable`.
- `toMessageDtos` loads mentions, attachments, tasks, reactions and knowledge rows in parallel, then files and cards: a fixed number of queries for any page.

## Web

- `features/chat/reactions.tsx`: chips (count, mine highlighted with `aria-pressed`, tap toggles, optimistic until the answer), the "who reacted" popover (hover, focus or long press), the quick row; `reaction-picker.tsx` lazy.
- `features/chat/knowledge-cards.tsx`: the cards under a message; a click opens the lazy knowledge dialog, or for `ChatScope.knowledgeViaMessage` (the ticket page for a žiadateľ) the lazy read-only `shared-knowledge-dialog.tsx`.
- `features/chat/knowledge-picker.tsx` (lazy): a search dialog over `?shareable=1`; the composer shows picked items as chips and sends `knowledgeIds`.
- `use-channel-messages.ts` handles `chat:reactions` (window and cached threads, by `changeSeq`).

## Done when

A client reacts 👍 to an admin's message in the group chat and the admin sees the chip with 1 at once; the admin attaches a public note to a ticket chat message; the žiadateľ of that ticket opens it read-only; after the admin makes the note admins-only the card shows "Item unavailable" for everyone.
