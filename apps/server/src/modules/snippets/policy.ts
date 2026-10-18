import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/** What the policy needs of a snippet. */
export type SnippetRef = { authorId: string; shared: boolean };

/** Canned replies (F7) are an admin tool: admins and the superadmin, never a client. */
export function canUseSnippets(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** An admin reads their own snippets and every shared one. */
export function canReadSnippet(actor: SessionUser, snippet: SnippetRef): boolean {
  return canUseSnippets(actor) && (snippet.shared || snippet.authorId === actor.id);
}

/** Only the author edits, shares, unshares or deletes a snippet (the superadmin included). */
export function canChangeSnippet(actor: SessionUser, snippet: SnippetRef): boolean {
  return canUseSnippets(actor) && snippet.authorId === actor.id;
}
