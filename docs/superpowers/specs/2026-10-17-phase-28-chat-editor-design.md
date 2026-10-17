# Phase 28 (part a) — Rich text editor in every chat

Status: approved by the owner on 2026-10-17 (build without waiting). Roadmap: [Phase 28](../../roadmap.md#phase-28--chat-editor-and-ai-text-tools), first bullet only. The AI text tools, voice input, reactions and knowledge attachments are other parts built in parallel; this part gives them a stable composer API to plug into. ADR: [0025](../../decisions/0025-prosemirror-chat-editor.md).

## Goal

The composer of the group chat, the ticket chat and the task chat (all three are `Conversation` → `Composer`, plus the thread panel and the edit box) shows formatting while typing, instead of a textarea with raw Markdown. Messages stay stored as the same Markdown, so rendering, search, notifications, digests and the server do not change.

## What the person sees

- One field that looks like a sent message: bold, italic, strikethrough, inline code, links, mention pills, `- ` and `1. ` lists, `> ` quotes, fenced code blocks and (new) headings `#`, `##`, `###`. The content styles are the ones of `format/render.tsx`, so what is typed is what lands in the chat.
- Markdown shortcuts while typing, applied at once: `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``, `[text](https://…)`; at the start of a line `- ` (or `* `), `1. `, `> `, `# `/`## `/`### ` and ```` ``` ````. Backspace right after a shortcut undoes it (the raw characters come back); Backspace at the start of a list item, quote, heading or code block turns it back into a plain line.
- Pasted Markdown (plain text) renders. Pasted rich text (HTML from a web page or a document) keeps the formatting the chat supports and drops the rest. Copying out of the editor gives Markdown as plain text. Pasted images are still attached as files.
- The toolbar keeps its eight buttons (bold, italic, strike, link, bulleted list, numbered list, quote, code), shows which formats are active at the caret (`aria-pressed`), and keeps the shortcuts Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+Shift+X. Link opens a small address row inside the box ("Link address", "Add link"); with a selection it links the selection, without one it inserts the address as a link.
- Mentions: `@` opens the same picker (same filtering, same "Everyone" rules, same keyboard). A picked person becomes an atomic pill (deleted as one character), stored as `<@id>`.
- Enter rules stay as today: on a computer Enter sends and Shift+Enter starts a new line; on a touch screen Enter starts a new line and Send is the button. A "new line" is smart: in a list it starts the next item (on an empty item it leaves the list), in a code block it adds a line (an empty last line leaves the block), elsewhere it starts a new line. While the picker is open, Enter/Tab pick and Escape closes it; Escape in the edit box cancels the edit.
- The field grows up to eight lines and then scrolls, as before; the 9 000 / 10 000 character counter counts the stored Markdown.

## Storage model (Markdown ↔ editor)

- The editor's document is a ProseMirror tree with a schema of exactly the chat's Markdown subset: `paragraph`, `heading` (1–3), `blockquote`, `code_block`, `bullet_list`, `ordered_list` (keeps its start number), `list_item` (one paragraph, no nesting: the parser has none), `mention` (atom, attrs `id`, `label`), `hard_break`; marks `link`, `bold`, `italic`, `strike`, `code`.
- **Markdown → editor** reuses the message parser (`format/parse.ts`), so the editor understands exactly what the chat renders. Each line of a paragraph becomes its own editor paragraph and a blank line between two paragraphs becomes an empty one, so the editor shows lines the way the textarea did.
- **Editor → Markdown** (`editor/markdown.ts`): lines are joined with a single newline (an empty paragraph is a blank line), lists as `- ` / `N. `, quotes as `> ` per line, code blocks fenced with ```` ``` ````, headings as `#`. Whitespace at the edge of a mark moves outside it (`**a **` would not parse). A link whose text is its own address is written bare. Text is not escaped: a literal `**` that the person kept (by undoing a shortcut) is stored as typed, as with the textarea.
- Round trip: `toMarkdown(toDoc(md)) === md` for every body the composer itself produces (tested); other bodies are normalised (for example, extra blank lines collapse), which renders the same.
- The parser learns headings: a line `# `, `## ` or `### ` is a heading (shown at 1.125, 1 and 1 rem, semibold). Before this, such a line rendered as text; old messages that start a line with `# ` now show a heading (accepted, see decisions).

## Composer API for the other parts

`Composer` takes a `ref` (React 19 ref prop) of type `ComposerHandle`:

```ts
interface ComposerHandle {
  getMarkdown(): string;          // the draft as stored Markdown (mention tokens `<@id>`)
  setMarkdown(markdown: string): void; // replaces the draft; one undo step (Cmd/Ctrl+Z restores)
  focus(): void;
}
```

and an `extraActions?: ReactNode` prop rendered in the box's bottom row, just before Send (the slot for the AI button and the microphone). Inside `composer.tsx` the same handle is `editor.current`.

## Performance

- ProseMirror (core packages only, no Tiptap, no markdown-it) in its own lazy chunk `chat-editor`, requested as soon as the `conversation` chunk loads, in parallel with the messages; until it arrives the box shows a placeholder of the same height. The entry chunk does not change (the composer was already lazy).
- Measured in the ADR: ProseMirror core 67 kB gzip, Lexical 95 kB, Tiptap 144 kB (with their Markdown support).
- Per keystroke the composer serialises the document once (linear, ≤ 10 000 characters) for the counter and Send state.

## Out of scope

The bulk email builder, the task description (still a textarea with the same toolbar), nested lists, tables, images inline in text.

## Decisions for the owner

1. **Headings in old messages.** A message line that starts with `# ` (hash, space) now shows as a heading. Before, it showed as text. Rare in chat; accepted unless the owner objects.
2. **Enter in code blocks and lists on a computer** sends the message, as everywhere else (Shift+Enter adds a line / next item), so the rule stays one rule. Slack-like alternative: Enter adds a line inside a code block. Default: one rule.
3. **No escaping**: a literal `**word**` cannot be stored as text (it shows bold when sent), same as before. Escaping would need a backslash rule in the parser that changes how existing messages with `\` render.
4. **Headings 1–3 only** (`#`, `##`, `###`), no toolbar button for them or for code blocks (Markdown shortcuts only), to keep the toolbar row short on phones.
