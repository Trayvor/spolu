import type { Db } from '../../infra/db/client.js';

/**
 * Called inside the transaction that edits or deletes a message, after its row changed: another
 * module drops what it derived from the old text (the AI module's stored translations,
 * 2026-10-19) without the chat module importing it. A throwing hook rolls the change back.
 */
export type MessageBodyHook = (tx: Db, messageId: string) => Promise<void>;

const hooks: MessageBodyHook[] = [];

/** Registers a hook; called once at start-up (a second call with the same one is ignored). */
export function onMessageBodyChange(hook: MessageBodyHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

export async function runMessageBodyChange(tx: Db, messageId: string): Promise<void> {
  for (const hook of hooks) await hook(tx, messageId);
}
