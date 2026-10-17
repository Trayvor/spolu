import { useEffect, useState } from 'react';
import type { MessageAttachedTask, MessageAttachedTicket } from '@spolu/shared';
import type { PickedKnowledge } from '../knowledge-picker';

export type PickedTask = Extract<MessageAttachedTask, { available: true }>;
export type PickedTicket = Extract<MessageAttachedTicket, { available: true }>;

/** Everything chosen for one message, across the three tabs of the picker. */
export type Picked = {
  knowledge: PickedKnowledge[];
  tasks: PickedTask[];
  tickets: PickedTicket[];
};

export const NOTHING_PICKED: Picked = { knowledge: [], tasks: [], tickets: [] };

export const pickedCount = (p: Picked): number =>
  p.knowledge.length + p.tasks.length + p.tickets.length;

/** Adds or removes one entry by id, never beyond `max`. */
export function toggled<T extends { id: string }>(list: T[], item: T, max: number): T[] {
  if (list.some((x) => x.id === item.id)) return list.filter((x) => x.id !== item.id);
  return list.length >= max ? list : [...list, item];
}

/** How long a search waits after the last key. */
const SEARCH_DELAY_MS = 250;

/** The search field's text and, a moment after the last key, the trimmed query to send. */
export function useSearchText(): { text: string; setText: (v: string) => void; q: string } {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = text.trim();
      // The server searches from 2 characters (a ticket number may be a single digit).
      setQ(trimmed.length >= 2 || /^\d$/.test(trimmed) ? trimmed : '');
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return { text, setText, q };
}
