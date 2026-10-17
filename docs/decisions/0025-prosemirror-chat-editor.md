# 0025 ProseMirror core for the chat composer, with our own Markdown conversion

Date: 2026-10-17
Status: accepted

## Context
Phase 28 asks for a WYSIWYG composer in every chat (group, ticket and task chat): Markdown shortcuts turn into formatting while typing, pasted Markdown renders, mentions and attachments keep working, and messages stay stored as the chat's Markdown subset (spec: [Phase 28 chat editor](../superpowers/specs/2026-10-17-phase-28-chat-editor-design.md)). The textarea could only show raw Markdown. Bundles and performance are a top priority, and the initial JS budget is nearly used up, so the editor must be lazy and as small as possible.

A `contenteditable` with the browser's editing commands is enough for the bulk email builder ([ADR 0024](0024-bulk-email-content-v2.md)), but not here: input rules on every keystroke, lists that continue on a new line, atomic mention pills, undo that covers the shortcuts, paste of HTML and Markdown, and the same behaviour in Safari, Chrome and Firefox on phones are exactly what an editor engine solves.

Measured (2026-10-17, esbuild, minified, gzip -9, only what the composer needs):

| Option | gzip |
|---|---|
| ProseMirror core (`model`, `state`, `view`, `transform`, `commands`, `keymap`, `inputrules`, `history`, `schema-list`) | 67 kB |
| the same plus `prosemirror-markdown` (and its `markdown-it`) | 126 kB |
| Lexical 0.52 (`lexical`, `rich-text`, `list`, `link`, `markdown`, `history`, `utils`; production build) | 95 kB |
| Tiptap 3 (`core`, `starter-kit`, `markdown`) | 144 kB |
| a textarea with a highlight overlay (Markdown characters stay visible) | about 3 kB, but it is not WYSIWYG: headings and lists cannot change size without breaking the overlay, and the owner asked for the characters to turn into formatting |

## Decision
- **ProseMirror core packages, pinned exactly, without Tiptap and without `prosemirror-markdown`.** A schema of exactly the chat's Markdown subset (`editor/schema.ts`), our own input rules and commands (`editor/setup.ts`), and our own conversion (`editor/markdown.ts`): Markdown → editor reuses the message parser `format/parse.ts`, so the editor understands exactly what the chat renders; editor → Markdown is a small serializer. No second Markdown parser, and the round trip is tested.
- **Lazy, in its own chunk** (`chat-editor`, about 70 kB gzip with our code), requested by the composer module as soon as the lazy `conversation` chunk runs, in parallel with the messages. The initial JS does not carry it.
- **Headings** (`#`, `##`, `###`) join the chat's Markdown subset in the parser and the renderer.

## Consequences
- The editor chunk is about 70 kB gzip, downloaded once per version and cached by the service worker. Chats open as fast as before: until the chunk arrives the box shows a placeholder of the same height.
- The composer's draft is Markdown everywhere (`ComposerHandle.getMarkdown()` / `setMarkdown()`), so the AI text tools and voice input of Phase 28 plug into it without knowing ProseMirror.
- Nothing on the server, in search, notifications or digests changes: the stored body is the same Markdown.
- The task description keeps its textarea and the same toolbar; moving it to the editor later is a small step (the schema and conversion are reusable).
- jsdom has no layout: component tests stub `Range.getClientRects`, `Range.getBoundingClientRect` and `document.elementFromPoint` (`src/test/setup.ts`); user-event typing works against the editor.
