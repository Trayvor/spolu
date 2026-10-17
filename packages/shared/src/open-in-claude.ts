import { z } from 'zod';

// "Otvoriť v Claude" (Phase 29): an admin opens claude.ai with the context of a ticket or task.
// A module of its own so the web bundles it with the lazy button only.

/**
 * The longest `https://claude.ai/new?q=…` URL the button opens (encoded, whole URL). Proxies and
 * CDNs commonly reject request lines above 8 KB (414/431); a longer prompt goes through the
 * clipboard instead. See docs/superpowers/specs/2026-10-17-phase-29-open-in-claude-design.md.
 */
export const CLAUDE_URL_MAX = 8000;

/** The longest prompt the server builds; the oldest chat messages are dropped first. */
export const CLAUDE_PROMPT_MAX = 20_000;

/** An empty Claude chat, opened when the prompt goes through the clipboard. */
export const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';

/** The prefilled Claude chat for `prompt`. */
export function claudeChatUrl(prompt: string): string {
  return `${CLAUDE_NEW_CHAT_URL}?q=${encodeURIComponent(prompt)}`;
}

/** The admin's optional notes for Claude, at most this many characters. */
export const CLAUDE_NOTES_MAX = 4000;

/** `POST /api/tickets/:id/claude-prompt` and `POST /api/tasks/:id/claude-prompt`. */
export const ClaudePromptRequestSchema = z.object({
  notes: z.string().max(CLAUDE_NOTES_MAX).optional().default(''),
});
export type ClaudePromptRequest = z.input<typeof ClaudePromptRequestSchema>;

/**
 * The prompt and the files it names (the ticket's or task's own and those attached in its chat):
 * claude.ai takes no files by URL, so the admin downloads and attaches them by hand.
 */
export const ClaudePromptSchema = z.object({
  prompt: z.string(),
  files: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type ClaudePrompt = z.infer<typeof ClaudePromptSchema>;
