import { useSyncExternalStore } from 'react';

/**
 * Time on done (Phase 32): what the time dialog asks about. A task completed by an admin
 * assignee (the move, create or update answer said `askTime`), a ticket resolved by an admin
 * riešiteľ, a "Fill in your time" row on the dashboard, a `?time=1` link from a notification, or
 * "Fill in" / "Edit" under My time.
 */
export type TimeAsk =
  | { kind: 'task'; id: string; groupId: string; title: string }
  | { kind: 'ticket'; id: string; groupId: string | null; title: string };

/** A ticket's name in the dialog and the rows: "#123 Subject" (as its time entry stores it). */
export const ticketAskTitle = (number: number, subject: string | null) =>
  `#${number} ${subject ?? ''}`.trim();

/**
 * A small queue (spec §5.2): several tasks completed quickly open one dialog after another,
 * never two at once. The head is the open dialog; `finishTimeAsk` closes it and opens the next.
 * Asking again about what is already queued does nothing.
 */
let queue: readonly TimeAsk[] = [];
const listeners = new Set<() => void>();

function set(next: readonly TimeAsk[]) {
  queue = next;
  for (const listener of listeners) listener();
}

export function askForTime(ask: TimeAsk): void {
  if (queue.some((q) => q.kind === ask.kind && q.id === ask.id)) return;
  set([...queue, ask]);
}

/** The open dialog is done (saved or "Later"): the next one opens. */
export function finishTimeAsk(): void {
  set(queue.slice(1));
}

/** Empties the queue (sign-out, tests). */
export function clearTimeAsks(): void {
  set([]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The dialog to show now, if any. */
export function useTimeAsk(): TimeAsk | undefined {
  return useSyncExternalStore(
    subscribe,
    () => queue[0],
    () => undefined,
  );
}
