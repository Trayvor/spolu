/**
 * Unsent composer text, kept while the composer is unmounted (switching a task's panel, a client's
 * group tab or a ticket chat). Memory only, never browser storage: nothing remains on a shared
 * computer, and a page reload forgets it. Only the text (Markdown with mention tokens); files,
 * picked knowledge, tasks, tickets and the quoted reply are not kept.
 */
const drafts = new Map<string, string>();

/** One draft per chat, and one per thread of that chat. */
export const draftKey = (channelId: string, threadId?: string) =>
  threadId === undefined ? channelId : `${channelId}/${threadId}`;

export const readDraft = (key: string) => drafts.get(key) ?? '';

/** An empty (or blank) text removes the entry. */
export function saveDraft(key: string, markdown: string) {
  if (markdown.trim() === '') drafts.delete(key);
  else drafts.set(key, markdown);
}

export function removeDraft(key: string) {
  drafts.delete(key);
}

/** Every draft: the session ended (`clearSession`), and between tests. */
export function clearDrafts() {
  drafts.clear();
}
