# Global search and quick switcher

Built 2026-10-18 ([spec](../superpowers/specs/2026-10-18-global-search-design.md)). For everyone (owner decision): each person finds only what they can already open.

## What it finds

| type | admins | clients | žiadatelia |
|---|---|---|---|
| groups | every client and the admin group "eGrant tím" | their own groups | none |
| tickets (`#4821`, `4821` or words of the subject) | every ticket, also without a client | every ticket of their groups | only the tickets they started |
| tasks (title) | every board, the admin group's too | their groups' boards | none |
| knowledge (title, text, link, file names) | every item, admins-only ones too | public items of their groups | none |
| projects and events (name) | every client | their groups | none |
| people (name or email) | every active person | never | never |

A deactivated group is left out entirely, for admins too (owner decision of 2026-10-18): nobody finds the group, its tickets, tasks, knowledge items, projects or events. Its people are still found by admins (they are accounts, not the group's content), but a person whose only group is deactivated has no group to open, so the palette leaves them out. The MCP `search` tool answers the same.

Finance documents, contracts and time are never in the search, for finance admins either. Chat messages are not searched yet (message search is Phase 16). Files sent in chats are not listed (they stay with their message).

Typing ignores diacritics and case ("luky" finds "Lúky"). Every word must match. The best match comes first: the whole name, then a name starting with the text, then a word starting with it; open tickets and tasks before resolved and done ones.

## Where

- **Header:** a magnifier button before the account menu, on every screen and every width.
- **Keyboard:** Cmd+K (Mac) or Ctrl+K anywhere opens the palette.
- **Phone:** the same button opens a full-screen sheet with a Cancel button.

The palette lists, before anything is typed, the last opened items (per device) and quick actions: the person's sections (as in the header), Settings, and inside a group "New task in this group". From 2 characters it shows the hits, at most 5 per type. Up and Down move, Enter opens, Escape or Back closes.

A hit opens: a group its Chat tab; a ticket its page; a task its panel over the group's board; a knowledge item in the group's Knowledge tab; a project or event the group's Prehľad tab on that project; an admin the Administrators page; a client their first group's Members tab.

## AI assistants

The MCP `search` tool asks the same route ([integrations/mcp.md](../integrations/mcp.md)).
